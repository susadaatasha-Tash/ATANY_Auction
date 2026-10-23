p='sales.controller.js'
s=open(p).read()
old='''    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code,
             branch_id, payment_method, payment_deadline, winner_confirmed_at
            FROM orders WHERE auction_id IN (${orderIds.map((_, i) => `$${i + 1}$).join(',')}) ORDER BY created_at DESC`,
      orderIds
    );'''
new='''    const orderIds = orders.map((_, i) => '$' + (i + 1)).join(',');
    const { rows: orders } = await pool.query(
      `SELECT id, auction_id, buyer_id, amount, status, created_at, transaction_code,
             branch_id, payment_method, payment_deadline, winner_confirmed_at
            FROM orders WHERE auction_id IN (\${orderIds}) ORDER BY created_at DESC\`,
      orderIds
    );'''
if old in s:
    s=s.replace(old,new,1)
    open(p,'w').write(s)
    print("patched successfully")
else:
    print("oldString not found")
    lines=s.split('\n')
    for i,line in enumerate(lines[34:42],start=34):
        print(f"{i}: {repr(line)}")
