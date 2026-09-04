import mysql.connector

DB_CONFIG = {
    'host': '10.203.0.28',
    'port': 3306,
    'user': 'appuser',
    'password': 'msU1ceq~ST)2(Lf8',
    'database': 'higoplat_fusion_mes'
}

SEARCH_PHRASE = 'Gearbox'   # поиск по подстроке

conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor()

cursor.execute("SHOW TABLES")
tables = [row[0] for row in cursor.fetchall()]
print(f"Всего таблиц в MES: {len(tables)}")
print(f"Ищем '{SEARCH_PHRASE}' во всех текстовых полях...\n")

found_any = False

for table in tables:
    cursor.execute(f"SHOW COLUMNS FROM `{table}`")
    columns_info = cursor.fetchall()
    
    text_columns = []
    for col in columns_info:
        col_name = col[0]
        col_type = col[1].lower()
        if any(t in col_type for t in ('char', 'text', 'enum', 'set')):
            text_columns.append(col_name)
    
    if not text_columns:
        continue
    
    for col in text_columns:
        try:
            query = f"SELECT * FROM `{table}` WHERE `{col}` LIKE %s LIMIT 3"
            cursor.execute(query, (f'%{SEARCH_PHRASE}%',))
            rows = cursor.fetchall()
            if rows:
                col_names = [desc[0] for desc in cursor.description]
                vin_col = next((c for c in col_names if 'vin' in c.lower()), None)
                
                print(f"\n🔍 Таблица `{table}`, столбец `{col}`:")
                for row in rows:
                    row_dict = dict(zip(col_names, row))
                    if vin_col:
                        print(f"   VIN: {row_dict[vin_col]}")
                    print(f"   {col}: {row_dict[col]}")
                    # Дополнительно покажем другие непустые поля с ключевыми словами
                    for k, v in row_dict.items():
                        if k not in (col, vin_col) and v is not None:
                            if any(kw in str(v).lower() for kw in ('block', 'lock', 'статус', 'причин')):
                                print(f"   {k}: {v}")
                    print("   ---")
                    found_any = True
        except Exception:
            continue

cursor.close()
conn.close()

if not found_any:
    print("Значение не найдено в MES. Возможно, оно в другой базе (LES/ITO).")
else:
    print("\n✅ Поиск завершён.")