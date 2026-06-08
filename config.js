// ============================================================================
//  Supabase connection settings.
//
//  Left BLANK on purpose: this repo is public (free GitHub Pages needs that),
//  so the key must not live in the source. The GitHub Actions deploy workflow
//  (.github/workflows/deploy.yml) regenerates this file at deploy time from the
//  repo Secrets SUPABASE_URL and SUPABASE_ANON_KEY, so the published site still
//  connects automatically with no setup screen.
//
//  For LOCAL dev you can temporarily paste your values below (don't commit them),
//  or just open with ?demo=1, or use the in-app first-run setup screen.
// ============================================================================
window.PP_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
};
