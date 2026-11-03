SELECT TOP 2000 q_orders.status AS status, CAST(sum(q_orders.qty) AS FLOAT) / nullif(count(*), 0) AS pieces_per_order, CAST(count(*) AS FLOAT) / nullif(sum(q_orders.qty), 0) AS orders_per_piece 
FROM q_orders GROUP BY q_orders.status ORDER BY [status] ASC
