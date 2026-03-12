// Mock do Supabase Client

const mockSupabaseAdmin = {
  auth: {
    admin: {
      createUser: jest.fn(),
      updateUserById: jest.fn(),
      deleteUser: jest.fn(),
      getUserById: jest.fn(),
      listUsers: jest.fn(),
    },
    getUser: jest.fn(),
  },
};

const mockSupabase = {
  auth: {
    getUser: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
  },
};

module.exports = {
  mockSupabaseAdmin,
  mockSupabase,
  supabaseAdmin: mockSupabaseAdmin,
  supabase: mockSupabase,
};
