import unittest
import subprocess
import sys
from pathlib import Path

class TestDocSuiteKitMain(unittest.TestCase):
    def setUp(self):
        self.main_path = Path(__file__).parent.parent.parent / "main.py"
        
    def test_cli_help(self):
        """Test that the CLI can be invoked and prints help."""
        result = subprocess.run([sys.executable, str(self.main_path), "--help"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertIn("Zero-cost, offline document processing suite.", result.stdout)

    def test_cli_missing_command(self):
        """Test that missing required arguments correctly exit with error."""
        result = subprocess.run([sys.executable, str(self.main_path)], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("the following arguments are required: command", result.stderr)

if __name__ == '__main__':
    unittest.main()
