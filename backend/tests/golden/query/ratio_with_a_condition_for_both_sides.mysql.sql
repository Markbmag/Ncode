SELECT sum(CASE WHEN (q_orders.status = 'paid') THEN q_orders.total END) * 1E0 / nullif(sum(CASE WHEN (q_orders.status = 'paid') THEN q_orders.qty END), 0) AS per_piece, count(*) AS n 
FROM q_orders 
 LIMIT 2000
