// The Supabase project CrowdPulse talks to.
// The publishable key is meant to be public (it ends up in every visitor's browser anyway). What protects the data
// is the database's own rules in supabase/migrations: browsers can only call the functions granted there.
// The dev server and the build can point at another project with SUPABASE_URL and SUPABASE_KEY.
window.CP_CONFIG = {
  supabaseUrl: 'https://btvgsyeekztbrdscuavo.supabase.co',
  supabaseKey: 'sb_publishable_Y7NZMa_cnLTBixi8a4-6cw_KElkvBz_',
};
