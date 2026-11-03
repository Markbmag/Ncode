SELECT q_orders.status AS status, CAST(sum(q_orders.qty) AS DOUBLE PRECISION) / nullif(count(*), 0) AS pieces_per_order, CAST(count(*) AS DOUBLE PRECISION) / nullif(sum(q_orders.qty), 0) AS orders_per_piece 
FROM q_orders GROUP BY q_orders.status ORDER BY "status" ASC 
 LIMIT 2000
