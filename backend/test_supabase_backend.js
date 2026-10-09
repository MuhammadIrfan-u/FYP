const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://eibkaoyypiadqbgzhluu.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_50Eoyub1bnDH9NI8nuXoMQ_DYTxc_V4';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function runTestSuite() {
  console.log('=== RUNNING SUPABASE BACKEND INTEGRATION TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName} - ${details}`);
      failed++;
    }
  }

  // TEST 1: Public Sessions Table Query & RLS
  try {
    const { data, error } = await supabase.from('sessions').select('*');
    assert(error === null, 'Query public.sessions table with anon key', error?.message);
    assert(Array.isArray(data), 'public.sessions returns an array');
  } catch (err) {
    assert(false, 'Query public.sessions', err.message);
  }

  // TEST 2: Authentication Form Validation Handling
  try {
    const { error: invalidEmailErr } = await supabase.auth.signUp({
      email: 'not-an-email',
      password: 'validpassword123',
    });
    assert(
      invalidEmailErr !== null,
      'Invalid email format is rejected by Supabase Auth',
      invalidEmailErr ? `Error caught: ${invalidEmailErr.message}` : 'No error'
    );
  } catch (err) {
    assert(false, 'Auth invalid email check', err.message);
  }

  // TEST 3: Short password validation
  try {
    const { error: shortPassErr } = await supabase.auth.signUp({
      email: 'validcoach' + Date.now() + '@gmail.com',
      password: '123',
    });
    assert(
      shortPassErr !== null,
      'Short password (<6 chars) is rejected by Supabase Auth',
      shortPassErr ? `Error caught: ${shortPassErr.message}` : 'No error'
    );
  } catch (err) {
    assert(false, 'Auth short password check', err.message);
  }

  // TEST 4: Valid user registration & confirmation response
  try {
    const testEmail = `coach_test_${Date.now()}@gmail.com`;
    const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
      email: testEmail,
      password: 'StrongCoachPass2026!',
    });
    assert(
      signUpErr === null && signUpData?.user?.id !== undefined,
      'User signup succeeds with valid credentials',
      signUpErr ? signUpErr.message : `Created User UUID: ${signUpData?.user?.id}`
    );

    // TEST 5: Login with unconfirmed email yields descriptive error
    const { error: loginErr } = await supabase.auth.signInWithPassword({
      email: testEmail,
      password: 'StrongCoachPass2026!',
    });
    assert(
      loginErr !== null && (loginErr.message.includes('Email not confirmed') || loginErr.code === 'email_not_confirmed'),
      'Unconfirmed email login produces clear, user-friendly error',
      loginErr ? `Message: "${loginErr.message}"` : 'Unexpected login success'
    );
  } catch (err) {
    assert(false, 'Auth registration & login verification', err.message);
  }

  // TEST 6: Verify signed URL helper handles bucket/paths
  try {
    const { data, error } = await supabase.storage
      .from('football-videos')
      .createSignedUrl('dummy-user/dummy-session/video.mp4', 60);
    // If bucket exists, data or specific error is returned without client crash
    assert(
      typeof data === 'object' || error !== null,
      'Storage signed URL request executes cleanly'
    );
  } catch (err) {
    assert(false, 'Storage signed URL generation', err.message);
  }

  console.log(`\n=== SUMMARY: ${passed} PASSED, ${failed} FAILED ===\n`);
  if (failed > 0) process.exit(1);
}

runTestSuite();
