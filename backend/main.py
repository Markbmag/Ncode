import asyncio
import uuid
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, time
from decimal import Decimal
from typing import Dict, List, Any
import mysql.connector
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

# Разрешаем CORS для фронтенда (в проде укажите конкретный домен)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Конфигурации БД
DB_CONFIGS = {
    "mes": {
        "name": "MES",
        "config": {
            "host": "10.203.0.28",
            "port": 3306,
            "user": "appuser",
            "password": "msU1ceq~ST)2(Lf8",
            "database": "higoplat_fusion_mes"
        }
    },
    "les": {
        "name": "LES",
        "config": {
            "host": "10.203.0.29",
            "port": 3306,
            "user": "appuser",
            "password": "msU1ceq~ST)2(Lf8",
            "database": "higoplat_fusion_les"
        }
    },
    "iot": {
        "name": "IOT",
        "config": {
            "host": "10.203.0.141",
            "port": 3306,
            "user": "higoplat_iot_readonly",
            "password": "U1JfKmn*a356s",
            "database": "higoplat_lingxi"
        }
    }
}

# Глобальные структуры для задач и пул потоков
tasks: Dict[str, Dict[str, Any]] = {}
executor = ThreadPoolExecutor(max_workers=10)

def serialize_value(value):
    """Преобразует значение в тип, сериализуемый JSON."""
    if isinstance(value, Decimal):
        return float(value)
    elif isinstance(value, (datetime, date, time)):
        return value.isoformat()
    elif isinstance(value, bytes):
        return value.decode('utf-8', errors='ignore')
    else:
        return value

def get_text_columns(connection, table):
    """Получить текстовые колонки таблицы."""
    cursor = connection.cursor()
    cursor.execute("""
        SELECT COLUMN_NAME, DATA_TYPE 
        FROM information_schema.COLUMNS 
        WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
    """, (connection.database, table))
    columns_info = cursor.fetchall()
    cursor.close()
    text_columns = []
    for col_name, col_type in columns_info:
        if any(t in col_type.lower() for t in ('char', 'text', 'enum', 'set')):
            text_columns.append(col_name)
    return text_columns

def search_table(conn_params, table, search_phrase):
    """Поиск в одной таблице, возвращает список найденных записей."""
    results = []
    try:
        conn = mysql.connector.connect(**conn_params)
        cursor = conn.cursor()
        text_columns = get_text_columns(conn, table)
        if not text_columns:
            cursor.close()
            conn.close()
            return results

        cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
        count = cursor.fetchone()[0]
        if count == 0:
            cursor.close()
            conn.close()
            return results

        where_clause = " OR ".join([f"`{col}` LIKE %s" for col in text_columns])
        params = [f'%{search_phrase}%'] * len(text_columns)
        query = f"SELECT * FROM `{table}` WHERE {where_clause} LIMIT 10"
        cursor.execute(query, params)
        rows = cursor.fetchall()
        if rows:
            col_names = [desc[0] for desc in cursor.description]
            vin_col = next((c for c in col_names if 'vin' in c.lower()), None)
            for row in rows:
                row_dict = dict(zip(col_names, row))
                # Преобразуем все значения в сериализуемые
                for k, v in row_dict.items():
                    row_dict[k] = serialize_value(v)
                results.append({
                    "table": table,
                    "row": row_dict,
                    "vin_col": vin_col,
                    "cols": col_names
                })
        cursor.close()
        conn.close()
    except Exception:
        # Пропускаем ошибки отдельной таблицы
        pass
    return results

async def run_search_task(task_id: str, db_key: str, search_phrase: str):
    """Асинхронная обёртка: получает список таблиц, запускает поиск, обновляет прогресс."""
    loop = asyncio.get_event_loop()
    db_config = DB_CONFIGS[db_key]["config"]

    # Получаем список таблиц (в отдельном потоке)
    def get_tables():
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        cursor.execute("""
            SELECT TABLE_NAME 
            FROM information_schema.TABLES 
            WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        """, (db_config['database'],))
        tables = [row[0] for row in cursor.fetchall()]
        cursor.close()
        conn.close()
        return tables

    tables = await loop.run_in_executor(executor, get_tables)
    total = len(tables)
    tasks[task_id].update({"total": total, "processed": 0, "found": 0, "status": "running"})

    all_results = []
    processed = 0
    found = 0
    sem = asyncio.Semaphore(10)  # максимум одновременных соединений

    async def process_table(table):
        nonlocal processed, found, all_results
        async with sem:
            table_results = await loop.run_in_executor(
                executor, search_table, db_config, table, search_phrase
            )
        processed += 1
        found += len(table_results)
        all_results.extend(table_results)
        tasks[task_id].update({"processed": processed, "found": found})

    await asyncio.gather(*[process_table(t) for t in tables])
    tasks[task_id]["status"] = "completed"
    tasks[task_id]["results"] = all_results

@app.post("/api/search")
async def start_search(payload: dict):
    db_key = payload.get("db")
    search_phrase = payload.get("phrase")
    if db_key not in DB_CONFIGS or not search_phrase:
        return {"error": "Invalid parameters"}
    task_id = str(uuid.uuid4())
    tasks[task_id] = {"status": "starting", "total": 0, "processed": 0, "found": 0}
    asyncio.create_task(run_search_task(task_id, db_key, search_phrase))
    return {"task_id": task_id}

@app.websocket("/ws/{task_id}")
async def websocket_endpoint(websocket: WebSocket, task_id: str):
    await websocket.accept()
    try:
        while True:
            if task_id not in tasks:
                await websocket.send_text(json.dumps({"status": "unknown"}))
                break
            task = tasks[task_id]
            await websocket.send_text(json.dumps({
                "status": task.get("status"),
                "total": task.get("total", 0),
                "processed": task.get("processed", 0),
                "found": task.get("found", 0),
            }))
            if task.get("status") == "completed":
                # Отправляем результаты
                await websocket.send_text(json.dumps({
                    "status": "completed",
                    "results": task.get("results", [])
                }))
                break
            if task.get("status") == "error":
                break
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)