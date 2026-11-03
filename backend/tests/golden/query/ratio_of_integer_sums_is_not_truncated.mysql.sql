SELECT q_orders.status AS status, sum(q_orders.qty) * 1E0 / nullif(count(*), 0) AS pieces_per_order, count(*) * 1E0 / nullif(sum(q_orders.qty), 0) AS orders_per_piece 
FROM q_orders GROUP BY q_orders.status ORDER BY `status` ASC 
 LIMIT 2000
