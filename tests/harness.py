"""Load the SymPyStudio kernel (kernel/bootstrap.py + kernel/runner.py) into a fresh
namespace, exactly as the Pyodide worker does, so tests run against plain CPython."""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KERNEL_DIR = os.path.join(ROOT, 'kernel')
if KERNEL_DIR not in sys.path:
    sys.path.insert(0, KERNEL_DIR)


def load_kernel():
    ns = {'__name__': 'sympystudio_kernel'}
    for fname in ('bootstrap.py', 'runner.py'):
        with open(os.path.join(KERNEL_DIR, fname), encoding='utf-8') as fh:
            exec(compile(fh.read(), fname, 'exec'), ns)
    return ns


class Kernel:
    """Thin wrapper mirroring the calls the browser makes."""

    def __init__(self):
        self.ns = load_kernel()
        self.n = 0

    def run(self, latex, operation='eval', params=None, assign_to='', mode='visual', code=''):
        self.n += 1
        payload = {'mode': mode, 'latex': latex, 'code': code, 'operation': operation,
                   'params': params or {}, 'assignTo': assign_to, 'inIndex': self.n}
        return json.loads(self.ns['execute_notebook_cell'](json.dumps(payload)))

    def value(self, latex, operation='eval', params=None):
        res = self.run(latex, operation, params)
        if res['status'] != 'ok':
            raise AssertionError(f"{latex!r} failed: {res['message']}")
        return self.ns['out_history'][self.n]

    def code(self, latex, operation='eval', params=None, assign_to=''):
        payload = {'latex': latex, 'operation': operation, 'params': params or {}, 'assignTo': assign_to}
        return json.loads(self.ns['convert_visual_to_sympy_code'](json.dumps(payload)))
