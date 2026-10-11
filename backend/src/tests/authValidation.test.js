import { describe, it, expect, vi, beforeEach } from 'vitest';

const poolQuery = vi.fn();
const supabaseCreateUser = vi.fn();
vi.mock('../db/pool.js', () => ({
  pool: { query: (...a) => poolQuery(...a), connect: vi.fn(), on: vi.fn() },
  isDirectPg: () => true,
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    auth: {
      admin: { createUser: (...args) => supabaseCreateUser(...args) },
      signInWithPassword: vi.fn(),
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
  })),
}));

const { signup, syncUser } = await import('../controllers/auth.controller.js');

function mockRes() {
  const res = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe('backend email validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] });
    supabaseCreateUser.mockResolvedValue({ data: { user: { id: 'uid-1', email: 'test@example.com' } }, error: null });
  });

  it('invalid email -> 400 INVALID_EMAIL', async () => {
    const res = mockRes();
    await signup({ body: { email: 'klane', password: 'StrongPass123!', name: 'Test' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('INVALID_EMAIL');
    expect(body.field).toBe('email');
  });

  it('valid .ph domain accepted', async () => {
    const res = mockRes();
    await signup({ body: { email: 'person@company.ph', password: 'StrongPass123!', name: 'Test' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('email normalized to lowercase before Supabase call', async () => {
    const res = mockRes();
    await signup({ body: { email: '  Test@Email.COM  ', password: 'StrongPass123!', name: 'Test' } }, res);
    expect(supabaseCreateUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'test@email.com' }));
  });

  it('missing @ rejected', async () => {
    const res = mockRes();
    await signup({ body: { email: 'klane.gmail.com', password: 'StrongPass123!', name: 'Test' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('backend phone validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] });
    supabaseCreateUser.mockResolvedValue({ data: { user: { id: 'uid-2', email: 'p@test.com' } }, error: null });
  });

  it('invalid PH phone -> 400 INVALID_PHONE', async () => {
    const res = mockRes();
    await signup({ body: { email: 'p@test.com', password: 'StrongPass123!', name: 'Test', phone: '12345' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_PHONE');
  });

  it('9514118324 normalized to +639514118324 sent to Supabase', async () => {
    const res = mockRes();
    await signup({ body: { email: 'p2@test.com', password: 'StrongPass123!', name: 'Test', phone: '9514118324' } }, res);
    expect(supabaseCreateUser).toHaveBeenCalledWith(expect.objectContaining({ user_metadata: expect.objectContaining({ phone: '+639514118324' }) }));
  });

  it('09514118324 normalized', async () => {
    const res = mockRes();
    await signup({ body: { email: 'p3@test.com', password: 'StrongPass123!', name: 'Test', phone: '09514118324' } }, res);
    expect(supabaseCreateUser).toHaveBeenCalledWith(expect.objectContaining({ user_metadata: expect.objectContaining({ phone: '+639514118324' }) }));
  });

  it('9 digits after +63 is incomplete -> 400', async () => {
    const res = mockRes();
    await syncUser({ user: { id: 'uid-1', email: 'a@b.com', user_metadata: {} }, body: { name: 'A', phone: '951411832' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('INVALID_PHONE');
  });

  it('letters in phone rejected', async () => {
    const res = mockRes();
    await syncUser({ user: { id: 'uid-1', email: 'a@b.com', user_metadata: {} }, body: { name: 'A', phone: '95141abc24' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('public signup cannot submit role', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    poolQuery.mockResolvedValue({ rows: [] });
  });

  it('syncUser ignores role from body and metadata', async () => {
    let insertedRole = null;
    poolQuery.mockImplementation(async (sql, params) => {
      if (sql.includes('INSERT INTO public.users')) insertedRole = params[4];
      return { rows: [] };
    });
    const res = mockRes();
    await syncUser({ user: { id: 'uid-1', email: 'a@b.com', user_metadata: { role: 'admin' } }, body: { name: 'Hacker', role: 'shop_owner' } }, res);
    expect(insertedRole).toBe('customer');
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ role: 'customer' }));
  });

  it('signup admin path still allows shop_owner when requireRole admin (not public)', async () => {
    // This is admin-only, so it should allow shop_owner
    supabaseCreateUser.mockResolvedValue({ data: { user: { id: 'uid-admin', email: 'shop@test.com' } }, error: null });
    poolQuery.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await signup({ body: { email: 'shop@test.com', password: 'StrongPass123!', name: 'Shop', role: 'shop_owner' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});

describe('duplicate email mapped safely', () => {
  it('Supabase already exists -> EMAIL_ALREADY_EXISTS', async () => {
    supabaseCreateUser.mockResolvedValue({ data: {}, error: { message: 'User already registered', status: 422 } });
    const res = mockRes();
    await signup({ body: { email: 'dup@test.com', password: 'StrongPass123!', name: 'Dup' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('EMAIL_ALREADY_EXISTS');
    expect(res.json.mock.calls[0][0].field).toBe('email');
  });

  it('raw password never appears in error response', async () => {
    supabaseCreateUser.mockResolvedValue({ data: {}, error: { message: 'Some error', status: 400 } });
    const res = mockRes();
    const pwd = 'SuperSecret123!';
    await signup({ body: { email: 'x@test.com', password: pwd, name: 'X' } }, res);
    const bodyStr = JSON.stringify(res.json.mock.calls[0][0]);
    expect(bodyStr).not.toContain(pwd);
    expect(bodyStr).not.toContain('SuperSecret');
  });
});

describe('backend password validation', () => {
  it('short password -> 400 WEAK_PASSWORD', async () => {
    const res = mockRes();
    await signup({ body: { email: 'x@test.com', password: '1234567', name: 'X' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].code).toBe('WEAK_PASSWORD');
  });
  it('8 chars passes', async () => {
    supabaseCreateUser.mockResolvedValue({ data: { user: { id: 'uid' } }, error: null });
    poolQuery.mockResolvedValue({ rows: [] });
    const res = mockRes();
    await signup({ body: { email: 'x2@test.com', password: '12345678', name: 'X' } }, res);
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
