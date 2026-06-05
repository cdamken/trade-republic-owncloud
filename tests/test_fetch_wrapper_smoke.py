"""
Smoke tests for python/fetch_wrapper.py — the subprocess that
ApiController spawns to fetch TR data.

These DO NOT hit the real TR API. They verify that the wrapper:
  • parses CLI flags correctly
  • returns the right exit code when args are missing
  • handles the --full flag
  • imports cleanly (no syntax errors)

Run with:  python3 -m unittest discover -s tests/

Uses stdlib unittest only — no pytest, no extra deps.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
WRAPPER = REPO_ROOT / 'python' / 'fetch_wrapper.py'

# Exit codes from TrService.php — keep in sync.
EXIT_OK = 0
EXIT_MFA_REQUIRED = 10
EXIT_MFA_INVALID = 11
EXIT_AUTH_FAILED = 12
EXIT_API_ERROR = 20
EXIT_TIMEOUT = 21
EXIT_CONFIG_ERROR = 30


def run_wrapper(args=None, env_extra=None, timeout=10):
    env = {
        'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
        'HOME': '/tmp',
        'LANG': 'C.UTF-8',
    }
    if env_extra:
        env.update(env_extra)
    try:
        r = subprocess.run(
            [sys.executable, str(WRAPPER), *(args or [])],
            env=env, capture_output=True, text=True, timeout=timeout,
        )
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, '', f'TIMEOUT after {timeout}s'


class TestFetchWrapperSmoke(unittest.TestCase):
    """Sanity checks that don't talk to the real TR API."""

    def test_wrapper_file_exists(self):
        self.assertTrue(WRAPPER.exists(), f'fetch_wrapper.py not found at {WRAPPER}')

    def test_wrapper_runs_help_without_python_crash(self):
        """--help must not crash with a Python error (covers basic syntax + imports)."""
        rc, _out, err = run_wrapper(['--help'])
        self.assertNotEqual(rc, 1, f'Wrapper crashed (exit 1): {err!r}')
        self.assertNotIn('Traceback', err, f'Python traceback: {err!r}')
        self.assertNotIn('SyntaxError', err, f'Syntax error: {err!r}')

    def test_missing_required_args_returns_argparse_error(self):
        """Without --profile-dir / --data-dir, argparse exits 2."""
        rc, _out, err = run_wrapper([])
        self.assertEqual(
            rc, 2,
            f'Expected argparse error (rc=2), got {rc}. stderr={err!r}'
        )
        self.assertIn('required', err.lower())

    def test_full_flag_recognized(self):
        """--full must not be rejected as 'unrecognized'."""
        with tempfile.TemporaryDirectory() as tmp:
            rc, _out, err = run_wrapper(
                ['--profile-dir', tmp, '--data-dir', tmp, '--full'],
                env_extra={},
                timeout=5,
            )
            self.assertNotIn('unrecognized', err.lower(),
                             f'--full rejected by argparse: {err!r}')
            self.assertNotIn('Traceback', err, f'Crash on --full: {err!r}')

    def test_exit_codes_match_php(self):
        """Every EXIT_* constant here should appear in TrService.php."""
        php = REPO_ROOT / 'lib' / 'Service' / 'TrService.php'
        text = php.read_text()
        for name in ('EXIT_OK', 'EXIT_MFA_REQUIRED', 'EXIT_MFA_INVALID',
                     'EXIT_AUTH_FAILED', 'EXIT_API_ERROR', 'EXIT_CONFIG_ERROR'):
            self.assertIn(name, text,
                          f'{name} missing from TrService.php — wrapper/PHP drift')


if __name__ == '__main__':
    unittest.main()
