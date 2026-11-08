import sympy as sp
from sympy import *
import re
import json
import math
import sys
import io
import ast

from sympy.parsing.sympy_parser import (
    parse_expr,
    standard_transformations,
    implicit_multiplication_application,
    convert_xor
)

# Global Persistent Memory
session_vars = {}
session_funcs = {}
session_assumptions = {}
out_history = {}

# Pre-defined standard physics & engineering coordinates
x, y, z, t, r, theta, phi = sp.symbols('x y z t r theta phi')
n, k, m, q, c, g, hbar, omega, zeta, alpha, beta, gamma, delta, epsilon, epsilon_0, lam, mu, rho, sigma, tau, psi, Delta, nu, mu_0, E_mod = sp.symbols(
    'n k m q c g hbar omega zeta alpha beta gamma delta epsilon epsilon_0 lambda mu rho sigma tau psi Delta nu mu_0 E_mod'
)

BASE_LOCALS = {
    'x': x, 'y': y, 'z': z, 't': t, 'r': r, 'theta': theta, 'phi': phi,
    'n': n, 'k': k, 'm': m, 'q': q, 'c': c, 'g': g, 'hbar': hbar,
    'omega': omega, 'zeta': zeta, 'alpha': alpha, 'beta': beta, 'gamma': gamma,
    'delta': delta, 'epsilon': epsilon, 'varepsilon_0': epsilon_0, 'epsilon_0': epsilon_0,
    'lambda': lam, 'lam': lam, 'mu': mu, 'rho': rho, 'sigma': sigma, 'tau': tau,
    'psi': psi, 'Delta': Delta, 'nu': nu, 'mu_0': mu_0, 'E_mod': E_mod,
    'pi': sp.pi, 'e': sp.E, 'E': sp.E, 'oo': sp.oo, 'infty': sp.oo, 'I': sp.I,
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh,
    'exp': sp.exp, 'ln': sp.log, 'log': sp.log, 'sqrt': sp.sqrt, 'Abs': sp.Abs,
    'Matrix': sp.Matrix, 'Function': sp.Function, 'Derivative': sp.Derivative, 'Integral': sp.Integral,
    'summation': sp.summation, 'product': sp.product, 'limit': sp.limit, 'integrate': sp.integrate, 'diff': sp.diff
}

from latex_parser import (
    LatexParseError, ParseContext, Statement, parse_latex_expr, parse_latex_statement,
    to_code, symbol_declarations, python_name,
)

# How the visual parser treats e and i (E and I are always ordinary symbols)
parser_options = {'euler_e': True, 'imaginary_i': True}

_CALCULUS_NODES = (sp.Integral, sp.Derivative, sp.Sum, sp.Product, sp.Limit)
# Names in BASE_LOCALS that the visual parser must NOT treat as constants
_NOT_VISUAL_CONSTANTS = {'e', 'E', 'I'}


def set_parser_options(payload_json):
    data = json.loads(payload_json)
    for key in ('euler_e', 'imaginary_i'):
        if key in data:
            parser_options[key] = bool(data[key])
    return json.dumps({'status': 'ok', 'options': parser_options})


class _UserFunction:
    """A function defined in a cell, e.g. f(x) = x^2 sin(x)."""
    def __init__(self, name, params, body):
        self.name = name
        self.params = list(params)
        self.body = body

    def __call__(self, *call_args):
        if len(call_args) != len(self.params):
            raise ValueError(f"Function {self.name} expects {len(self.params)} argument(s), got {len(call_args)}.")
        return self.body.subs(dict(zip(self.params, [sp.sympify(a) for a in call_args])), simultaneous=True)


def get_eval_locals():
    """Namespace for Python code cells (SymPy semantics: E is Euler's number, I is sqrt(-1))."""
    loc = {k: getattr(sp, k) for k in getattr(sp, '__all__', []) if hasattr(sp, k)}
    loc.update(BASE_LOCALS)
    loc.update(session_vars)
    for fn_name, fn_info in session_funcs.items():
        loc[fn_name] = fn_info['callable']
    return loc


def reset_session_memory():
    session_vars.clear()
    session_funcs.clear()
    out_history.clear()
    return True


def make_parse_ctx(latest_idx=None, dependent=None):
    symbols = {}
    for k_name, v in BASE_LOCALS.items():
        if k_name in _NOT_VISUAL_CONSTANTS:
            continue
        if isinstance(v, sp.Symbol) or v in (sp.pi, sp.oo):
            symbols[k_name] = v
    return ParseContext(
        values=session_vars,
        symbols=symbols,
        functions={nm: info['callable'] for nm, info in session_funcs.items()},
        dependent=dependent or {},
        out_ref=_out_ref,
        latest_idx=latest_idx,
        euler_e=parser_options['euler_e'],
        imaginary_i=parser_options['imaginary_i'],
    )


def evaluate_calculus(expr):
    """Evaluate the integrals/derivatives/sums/limits a parsed expression contains."""
    if isinstance(expr, (sp.Basic, sp.MatrixBase)) and expr.has(*_CALCULUS_NODES):
        return expr.doit()
    return expr


def _sym(name, default='x'):
    """Symbol for a parameter field (variable / coordinate names), keeping registered assumptions."""
    raw = (str(name) if name is not None else '').strip() or default
    raw = raw.replace('\\', '').replace('{', '').replace('}', '').replace(' ', '')
    alias = {'varepsilon': 'epsilon', 'vartheta': 'theta', 'varphi': 'phi', 'lam': 'lambda'}
    raw = alias.get(raw, raw)
    v = session_vars.get(raw)
    if isinstance(v, sp.Symbol):
        return v
    b = BASE_LOCALS.get(raw)
    if isinstance(b, sp.Symbol):
        return b
    return sp.Symbol(raw)


def _syms(names_csv, default='x, y, z'):
    parts = [p for p in re.split(r'[,\s]+', str(names_csv or '').strip()) if p]
    if not parts:
        parts = [p for p in re.split(r'[,\s]+', default) if p]
    return [_sym(p) for p in parts]


def _out_ref(idx):
    if idx in out_history:
        return out_history[idx]
    raise ValueError(f"Output reference %{idx} does not exist yet.")


def parse_math_full(latex_str, latest_idx=None, dependent=None):
    """Return (unevaluated, evaluated, ctx) for a LaTeX input."""
    ctx = make_parse_ctx(latest_idx, dependent)
    uneval = parse_latex_expr(latex_str, ctx)
    return uneval, evaluate_calculus(uneval), ctx


def parse_math_input(latex_str, latest_idx=None):
    """Backwards-compatible helper: (evaluated expression, python code of the parsed input)."""
    uneval, value, _ = parse_math_full(latex_str, latest_idx)
    return value, to_code(uneval)


def latex_to_sympy_str(latex_str, latest_idx=None):
    """Python/SymPy source equivalent to a LaTeX input (kept for older callers)."""
    if not latex_str or not str(latex_str).strip():
        return '0'
    return to_code(parse_math_full(latex_str, latest_idx)[0])


def code_for(*exprs):
    """(declaration lines, printer) for showing parsed expressions as runnable SymPy code."""
    decl, renames = symbol_declarations(exprs)
    return decl, (lambda e: to_code(e, renames) if isinstance(e, (sp.Basic, sp.MatrixBase, list, tuple)) else repr(e))


def apply_symbol_assumptions(payload_json):
    data = json.loads(payload_json)
    raw_syms = data.get('symbols', '')
    pos = bool(data.get('positive', False))
    rl  = bool(data.get('real', False))
    itg = bool(data.get('integer', False))
    nz  = bool(data.get('nonzero', False))

    kw = {}
    if pos: kw['positive'] = True
    if rl:  kw['real'] = True
    if itg: kw['integer'] = True
    if nz:  kw['nonzero'] = True

    names = [s.strip() for s in re.split(r'[,\s]+', raw_syms) if s.strip() and re.match(r'^[a-zA-Z_][a-zA-Z0-9_]*$', s.strip())]
    for nm in names:
        sym_obj = sp.Symbol(nm, **kw)
        BASE_LOCALS[nm] = sym_obj
        session_vars[nm] = sym_obj
        flags = []
        if pos: flags.append('positive')
        if rl:  flags.append('real')
        if itg: flags.append('integer')
        if nz:  flags.append('nonzero')
        session_assumptions[nm] = flags or ['complex']

    return json.dumps({
        'status': 'ok',
        'session': serialize_session()
    })

def serialize_session():
    vars_list = []
    for k_name, val in session_vars.items():
        if isinstance(val, sp.Symbol) and str(val) == k_name and k_name in session_assumptions:
            # Shown in assumptions badges, only list in Assigned Symbols if assigned a value/expression
            continue
        vars_list.append({
            'name': k_name,
            'type': 'Matrix' if isinstance(val, sp.MatrixBase) else 'Symbol/Expr',
            'latex': sp.latex(val)
        })
    for f_name, f_info in session_funcs.items():
        vars_list.append({
            'name': f"{f_name}({', '.join(str(a) for a in f_info['args'])})",
            'type': 'Function',
            'latex': sp.latex(f_info['expr'])
        })
    outs_list = []
    for idx in sorted(out_history.keys()):
        val = out_history[idx]
        if val is not None:
            outs_list.append({
                'index': idx,
                'latex': sp.latex(val)
            })
    assumptions_list = [
        {'name': k, 'flags': v}
        for k, v in sorted(session_assumptions.items())
    ]
    return {'vars': vars_list, 'outs': outs_list, 'assumptions': assumptions_list}
