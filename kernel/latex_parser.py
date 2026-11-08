"""
Recursive-descent LaTeX -> SymPy parser for SymPyStudio.

MathLive emits LaTeX; this module turns it into SymPy objects by building a real
expression tree (tokenizer + precedence-climbing parser) instead of rewriting the
string with regular expressions.  Every interpretation that could be ambiguous is
either decided by an explicit, documented rule or reported back in
``ParseContext.warnings`` so the UI can show the user what was understood.

Symbol policy (see ParseContext):
  * ``E`` and ``I`` are ordinary symbols (Young's modulus, second moment of area,
    electric field, current ...).
  * ``e`` is Euler's number and ``i`` the imaginary unit by default; both can be
    switched off, and a bound index (``\\sum_{i=1}``) always wins.
  * ``\\exponentialE`` / ``\\imaginaryI`` (MathLive's explicit forms) are always the
    constants.

The module only depends on SymPy so it can be unit-tested with plain CPython.
"""

import re
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

import sympy as sp

__all__ = [
    'LatexParseError', 'ParseContext', 'Statement',
    'parse_latex_expr', 'parse_latex_statement', 'to_code', 'python_name',
]


class LatexParseError(ValueError):
    pass


# ---------------------------------------------------------------------------
# Tables
# ---------------------------------------------------------------------------

GREEK = {
    'alpha': 'alpha', 'beta': 'beta', 'gamma': 'gamma', 'delta': 'delta',
    'epsilon': 'epsilon', 'varepsilon': 'epsilon', 'zeta': 'zeta', 'eta': 'eta',
    'theta': 'theta', 'vartheta': 'theta', 'iota': 'iota', 'kappa': 'kappa',
    'lambda': 'lambda', 'mu': 'mu', 'nu': 'nu', 'xi': 'xi', 'rho': 'rho',
    'varrho': 'rho', 'sigma': 'sigma', 'varsigma': 'sigma', 'tau': 'tau',
    'upsilon': 'upsilon', 'phi': 'phi', 'varphi': 'phi', 'chi': 'chi',
    'psi': 'psi', 'omega': 'omega',
    'Gamma': 'Gamma', 'Delta': 'Delta', 'Theta': 'Theta', 'Lambda': 'Lambda',
    'Xi': 'Xi', 'Pi': 'Pi', 'Sigma': 'Sigma', 'Upsilon': 'Upsilon', 'Phi': 'Phi',
    'Psi': 'Psi', 'Omega': 'Omega', 'hbar': 'hbar', 'ell': 'ell',
}

# LaTeX function commands -> SymPy callables
FUNC_CMDS = {
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'arcsin': sp.asin, 'arccos': sp.acos, 'arctan': sp.atan,
    'arcsec': sp.asec, 'arccsc': sp.acsc, 'arccot': sp.acot,
    'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh, 'coth': sp.coth,
    'sech': sp.sech, 'csch': sp.csch,
    'exp': sp.exp, 'ln': sp.log, 'log': sp.log, 'lg': lambda a: sp.log(a, 10),
    'det': lambda a: a.det() if isinstance(a, sp.MatrixBase) else a,
    'max': sp.Max, 'min': sp.Min, 'gcd': sp.gcd, 'arg': sp.arg,
}
INVERSE_FUNCS = {
    sp.sin: sp.asin, sp.cos: sp.acos, sp.tan: sp.atan, sp.cot: sp.acot,
    sp.sec: sp.asec, sp.csc: sp.acsc, sp.sinh: sp.asinh, sp.cosh: sp.acosh,
    sp.tanh: sp.atanh, sp.coth: sp.acoth,
}

# Multi-letter function names recognised in plain-text style input ("sqrt(2)", "sinx")
# and inside \operatorname{...}
WORD_FUNCS = {
    'sin': sp.sin, 'cos': sp.cos, 'tan': sp.tan, 'cot': sp.cot, 'sec': sp.sec, 'csc': sp.csc,
    'asin': sp.asin, 'acos': sp.acos, 'atan': sp.atan, 'arcsin': sp.asin, 'arccos': sp.acos,
    'arctan': sp.atan, 'sinh': sp.sinh, 'cosh': sp.cosh, 'tanh': sp.tanh,
    'asinh': sp.asinh, 'acosh': sp.acosh, 'atanh': sp.atanh,
    'arsinh': sp.asinh, 'arcosh': sp.acosh, 'artanh': sp.atanh,
    'exp': sp.exp, 'ln': sp.log, 'log': sp.log, 'sqrt': sp.sqrt, 'abs': sp.Abs, 'Abs': sp.Abs,
    'sgn': sp.sign, 'sign': sp.sign, 'erf': sp.erf, 'erfc': sp.erfc, 'sinc': sp.sinc,
    'atan2': sp.atan2, 'floor': sp.floor, 'ceil': sp.ceiling, 'Re': sp.re, 'Im': sp.im,
    'tr': lambda a: a.trace() if isinstance(a, sp.MatrixBase) else a,
    'Gamma': sp.gamma, 'Heaviside': sp.Heaviside, 'DiracDelta': sp.DiracDelta,
}

# Function words a run of plain letters may be read as ("sqrt(2)", "sin x" typed as text)
RUN_FUNCS = {'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'asin', 'acos', 'atan', 'sinh', 'cosh',
             'tanh', 'exp', 'ln', 'log', 'sqrt', 'abs', 'Abs'}

CONSTANT_WORDS = {'pi': sp.pi, 'oo': sp.oo, 'infty': sp.oo, 'inf': sp.oo}

SKIP_CMDS = {
    'left', 'right', 'middle', 'mleft', 'mright', 'big', 'Big', 'bigg', 'Bigg',
    'bigl', 'bigr', 'Bigl', 'Bigr', 'biggl', 'biggr', 'displaystyle', 'textstyle',
    'scriptstyle', 'limits', 'nolimits', 'quad', 'qquad', ',', ';', ':', '!', ' ',
    'thinspace', 'medspace', 'thickspace', 'negthinspace', 'enspace',
}
TEXT_CMDS = {'mathrm', 'text', 'operatorname', 'textrm', 'mathit', 'textit', 'mathsf', 'textsf', 'mathtt'}
DECORATION_CMDS = {'vec', 'mathbf', 'boldsymbol', 'bm', 'hat', 'bar', 'tilde', 'overline',
                   'overrightarrow', 'mathcal', 'mathbb', 'widehat', 'widetilde'}
RELATION_CMDS = {'le': '<=', 'leq': '<=', 'leqslant': '<=', 'ge': '>=', 'geq': '>=',
                 'geqslant': '>=', 'ne': '!=', 'neq': '!=', 'lt': '<', 'gt': '>'}
MUL_CMDS = {'cdot', 'times', 'ast', 'bullet'}
BIG_OPS = {'int', 'sum', 'prod', 'lim', 'iint', 'iiint', 'oint'}
DELIM_ALIASES = {'vert': '|', 'lvert': '|', 'rvert': '|', 'mid': '|',
                 'Vert': '‖', 'lVert': '‖', 'rVert': '‖', '|': '‖',
                 'lbrace': '(', 'rbrace': ')', '{': '(', '}': ')',
                 'langle': '(', 'rangle': ')', 'lbrack': '[', 'rbrack': ']',
                 'lparen': '(', 'rparen': ')'}


# ---------------------------------------------------------------------------
# Tokenizer
# ---------------------------------------------------------------------------

@dataclass
class Tok:
    kind: str          # 'num' | 'letter' | 'cmd' | 'sym' | 'word' | 'begin' | 'end' | 'eof'
    value: str
    pos: int
    diff: bool = False  # explicit differential d (\mathrm{d}, \differentialD)

    def is_sym(self, *vals):
        return self.kind == 'sym' and self.value in vals

    def is_cmd(self, *vals):
        return self.kind == 'cmd' and self.value in vals

    def __repr__(self):
        return f"{self.kind}:{self.value}"


_NUM_RE = re.compile(r'\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\.\d+')


def _read_raw_group(s, i):
    """Return (content, new_index) for a balanced {...} group starting at s[i] (or a single char)."""
    while i < len(s) and s[i] == ' ':
        i += 1
    if i >= len(s):
        return '', i
    if s[i] != '{':
        if s[i] == '\\':
            m = re.match(r'\\[a-zA-Z]+', s[i:])
            if m:
                return m.group(0), i + len(m.group(0))
        return s[i], i + 1
    depth = 0
    for j in range(i, len(s)):
        if s[j] == '{':
            depth += 1
        elif s[j] == '}':
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
    raise LatexParseError("Unbalanced braces: missing '}'.")


def tokenize(src):
    s = src
    toks = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch.isspace() or ch == '~':
            i += 1
            continue
        if ch == '\\':
            m = re.match(r'\\([a-zA-Z]+)\*?', s[i:])
            if m:
                name = m.group(1)
                j = i + len(m.group(0))
                if name in SKIP_CMDS:
                    if name in ('left', 'right', 'middle', 'mleft', 'mright') or name.startswith(('big', 'Big')):
                        while j < n and s[j] == ' ':
                            j += 1
                        if j < n and s[j] == '.':
                            j += 1
                    i = j
                    continue
                if name in TEXT_CMDS:
                    content, j = _read_raw_group(s, j)
                    word = re.sub(r'\\[,;:! ]|\s', '', content)
                    if word == 'd':
                        toks.append(Tok('letter', 'd', i, diff=True))
                    elif word == 'e':
                        toks.append(Tok('cmd', 'exponentialE', i))
                    elif word == 'i':
                        toks.append(Tok('cmd', 'imaginaryI', i))
                    elif word:
                        toks.append(Tok('word', word, i))
                    i = j
                    continue
                if name in ('begin', 'end'):
                    env, j = _read_raw_group(s, j)
                    env = env.strip()
                    if name == 'begin' and env == 'array':
                        _, j = _read_raw_group(s, j)  # column spec
                    toks.append(Tok(name, env, i))
                    i = j
                    continue
                if name == 'differentialD':
                    toks.append(Tok('letter', 'd', i, diff=True))
                    i = j
                    continue
                if name in DELIM_ALIASES:
                    toks.append(Tok('sym', DELIM_ALIASES[name], i))
                    i = j
                    continue
                toks.append(Tok('cmd', name, i))
                i = j
                continue
            # control symbol: \, \; \{ \} \\ \% \|
            if i + 1 < n:
                c2 = s[i + 1]
                if c2 in ',;:! ':
                    i += 2
                    continue
                if c2 == '\\':
                    toks.append(Tok('sym', '\\\\', i))
                elif c2 == '%':
                    toks.append(Tok('sym', '%', i))
                elif c2 in DELIM_ALIASES:
                    toks.append(Tok('sym', DELIM_ALIASES[c2], i))
                else:
                    toks.append(Tok('sym', c2, i))
                i += 2
                continue
            i += 1
            continue
        if ch.isdigit() or (ch == '.' and i + 1 < n and s[i + 1].isdigit()):
            m = _NUM_RE.match(s, i)
            txt = m.group(0)
            # "2e^{x}" must stay 2*e^x; only accept exponent form when digits follow e
            toks.append(Tok('num', txt, i))
            i += len(txt)
            continue
        if ch.isalpha():
            toks.append(Tok('letter', ch, i))
            i += 1
            continue
        if ch == '*' and i + 1 < n and s[i + 1] == '*':
            toks.append(Tok('sym', '^', i))
            i += 2
            continue
        if ch in '<>!=' and i + 1 < n and s[i + 1] == '=':
            toks.append(Tok('sym', ch + '=', i))
            i += 2
            continue
        toks.append(Tok('sym', ch, i))
        i += 1
    toks.append(Tok('eof', '', n))
    return toks


# ---------------------------------------------------------------------------
# Context & results
# ---------------------------------------------------------------------------

@dataclass
class ParseContext:
    """Everything the parser needs to know about the session.

    values:     name -> SymPy value (session variables; Symbols carry assumptions)
    symbols:    name -> Symbol/constant table for pre-registered names (no values)
    functions:  name -> callable taking SymPy args (user-defined f(x) = ...)
    dependent:  name -> independent Symbol for ODE mode (y -> y(x))
    out_ref:    callable(index) -> value for %n recall
    """
    values: Dict[str, Any] = field(default_factory=dict)
    symbols: Dict[str, Any] = field(default_factory=dict)
    functions: Dict[str, Callable] = field(default_factory=dict)
    dependent: Dict[str, sp.Symbol] = field(default_factory=dict)
    out_ref: Optional[Callable[[int], Any]] = None
    latest_idx: Optional[int] = None
    euler_e: bool = True
    imaginary_i: bool = True
    warnings: List[str] = field(default_factory=list)

    def warn(self, msg):
        if msg not in self.warnings:
            self.warnings.append(msg)

    def known_names(self):
        """Multi-letter names that a run of plain letters may be merged into.

        Only names the user created, plus unambiguous words (sin, sqrt, theta, pi, oo).
        Two-letter Greek names (mu, nu, xi) are excluded so 'nu' typed as letters stays n*u."""
        names = set(self.values) | set(self.functions) | set(self.dependent)
        names |= {k for k in self.symbols if len(k) >= 3}
        names |= RUN_FUNCS | set(CONSTANT_WORDS) | {g for g in GREEK.values() if len(g) >= 3}
        return names


@dataclass
class Statement:
    kind: str                     # 'expr' | 'assign' | 'funcdef'
    expr: Any                     # parsed (unevaluated) expression / body / relation
    name: Optional[str] = None    # assignment target or function name
    args: List[sp.Symbol] = field(default_factory=list)


class _IntFrame:
    def __init__(self, var_name):
        self.var_name = var_name
        self.differential = None   # set when \frac{dx}{...} supplies it


# ---------------------------------------------------------------------------
# Parser
# ---------------------------------------------------------------------------

class _Parser:
    def __init__(self, toks, ctx, scopes=None, int_frames=None, src=''):
        self.toks = toks
        self.i = 0
        self.ctx = ctx
        self.scopes = scopes if scopes is not None else []
        self.int_frames = int_frames if int_frames is not None else []
        self.abs_depth = 0
        self.norm_depth = 0
        self.src = src

    # ----- token helpers -------------------------------------------------
    @property
    def tok(self):
        return self.toks[self.i]

    def peek(self, k=1):
        j = self.i + k
        return self.toks[j] if j < len(self.toks) else self.toks[-1]

    def advance(self):
        t = self.toks[self.i]
        if t.kind != 'eof':
            self.i += 1
        return t

    def error(self, msg, tok=None):
        tok = tok or self.tok
        near = self.src[tok.pos:tok.pos + 15] if self.src else tok.value
        if tok.kind == 'eof':
            raise LatexParseError(f"{msg} (at end of input)")
        raise LatexParseError(f"{msg} near '{near}'")

    def expect_sym(self, val, what=None):
        if not self.tok.is_sym(val):
            self.error(f"Expected '{val}'" + (f" {what}" if what else ''))
        return self.advance()

    def sub(self, toks):
        """Parser for a token sub-list sharing context/scopes."""
        p = _Parser(list(toks) + [Tok('eof', '', toks[-1].pos if toks else 0)], self.ctx,
                    self.scopes, self.int_frames, self.src)
        return p

    def parse_tokens(self, toks, what='expression'):
        if not toks:
            raise LatexParseError(f"Empty {what}.")
        p = self.sub(toks)
        val = p.parse_expr()
        if p.tok.kind != 'eof':
            p.error(f"Unexpected '{p.tok.value}' in {what}")
        return val

    def read_group_tokens(self):
        """Tokens of a braced group, or a single-token argument (LaTeX macro arg rules)."""
        t = self.tok
        if t.is_sym('{'):
            self.advance()
            depth = 1
            start = self.i
            while True:
                t2 = self.tok
                if t2.kind == 'eof':
                    self.error("Missing '}'")
                if t2.is_sym('{'):
                    depth += 1
                elif t2.is_sym('}'):
                    depth -= 1
                    if depth == 0:
                        inner = self.toks[start:self.i]
                        self.advance()
                        return inner
                self.advance()
        if t.kind == 'num':
            # \frac12 or x^23: a macro argument is a single digit
            self.advance()
            if len(t.value) > 1:
                self.i -= 1
                self.toks[self.i] = Tok('num', t.value[1:], t.pos + 1)
                return [Tok('num', t.value[0], t.pos)]
            return [t]
        if t.kind in ('letter', 'word'):
            self.advance()
            return [t]
        if t.kind == 'cmd':
            start = self.i
            self.advance()
            # include the command's own braced arguments (e.g. ^\frac{1}{2})
            while self.tok.is_sym('{'):
                self.read_group_tokens()
            return self.toks[start:self.i]
        if t.is_sym('+', '-'):
            self.advance()
            return [t]
        self.error("Expected an argument")

    def read_arg(self, what='argument'):
        return self.parse_tokens(self.read_group_tokens(), what)

    # ----- names & symbols -----------------------------------------------
    def lookup_bound(self, name):
        for scope in reversed(self.scopes):
            if name in scope:
                return scope[name]
        return None

    def symbol_for(self, name):
        """Symbol (with registered assumptions) for a name, ignoring assigned values."""
        b = self.lookup_bound(name)
        if b is not None:
            return b
        v = self.ctx.values.get(name)
        if isinstance(v, sp.Symbol):
            return v
        s = self.ctx.symbols.get(name)
        if isinstance(s, sp.Symbol):
            return s
        return sp.Symbol(name)

    def resolve_name(self, name):
        b = self.lookup_bound(name)
        if b is not None:
            return b
        if name in self.ctx.dependent:
            return sp.Function(name)(self.ctx.dependent[name])
        if name in self.ctx.values:
            return self.ctx.values[name]
        if name == 'e' and self.ctx.euler_e:
            return sp.E
        if name == 'i' and self.ctx.imaginary_i:
            return sp.I
        if name in ('e', 'i', 'E', 'I'):
            return sp.Symbol(name)
        if name in CONSTANT_WORDS:
            return CONSTANT_WORDS[name]
        s = self.ctx.symbols.get(name)
        if isinstance(s, (sp.Symbol, sp.NumberSymbol)) or s in (sp.oo, sp.zoo):
            return s
        return sp.Symbol(name)

    def read_subscript_name(self):
        """After '_', read a subscript used as part of an identifier name."""
        toks = self.read_group_tokens()
        parts = []
        for t in toks:
            if t.kind in ('letter', 'num', 'word'):
                parts.append(t.value)
            elif t.kind == 'cmd':
                parts.append(GREEK.get(t.value, t.value))
            elif t.is_sym(','):
                parts.append('')
            else:
                parts.append(t.value)
        sub = ''.join(parts)
        if not sub:
            self.error("Empty subscript")
        return sub if re.fullmatch(r'[A-Za-z0-9_]+', sub) else '{' + sub + '}'

    def at_ident_start(self, k=0):
        t = self.peek(k)
        return (t.kind == 'letter' and not t.diff) or (t.kind == 'cmd' and t.value in GREEK) or t.kind == 'word'

    def read_identifier_name(self, greedy_known=True):
        """Read an identifier: letters, greek command or \\mathrm word, plus an optional subscript.

        greedy_known=True merges a letter run into the longest known name, False takes the
        whole run (assignment targets), None takes a single letter (differentials)."""
        t = self.tok
        if t.kind == 'cmd' and t.value in GREEK:
            self.advance()
            name = GREEK[t.value]
        elif t.kind == 'word':
            self.advance()
            name = t.value
        elif t.kind == 'letter':
            run = []
            j = self.i
            while self.toks[j].kind == 'letter' and not self.toks[j].diff:
                if run and self.int_frames and self.at_differential(j - self.i):
                    break
                run.append(self.toks[j].value)
                j += 1
            take = 1
            if greedy_known and len(run) > 1:
                known = self.ctx.known_names()
                for L in range(len(run), 1, -1):
                    if ''.join(run[:L]) in known:
                        take = L
                        break
                run_start = self.i == 0 or self.toks[self.i - 1].kind != 'letter'
                if take == 1 and len(run) >= 3 and run_start:
                    word = ''.join(run)
                    self.ctx.warn(f"'{word}' was read as the product {'·'.join(run)}. "
                                  f"Assign it first ({word} = …) or write \\mathrm{{{word}}} to use it as one name.")
            elif greedy_known is False:
                take = len(run)
            name = ''.join(run[:take])
            self.i += take
        else:
            self.error("Expected a variable name")
        if self.tok.is_sym('_') and (t.kind != 'letter' or self.peek(-1).kind == 'letter'):
            self.advance()
            name = name + '_' + self.read_subscript_name()
        return name

    # ----- grammar ---------------------------------------------------------
    def parse_relation(self):
        left = self.parse_expr()
        rels = []
        while True:
            op = self.relop()
            if op is None:
                break
            right = self.parse_expr()
            rels.append((op, left, right))
            left = right
        if not rels:
            return left
        built = [_make_rel(op, a, b) for op, a, b in rels]
        return built[0] if len(built) == 1 else sp.And(*built)

    def relop(self):
        t = self.tok
        if t.kind == 'sym' and t.value in ('=', '<', '>', '<=', '>=', '!='):
            self.advance()
            return '==' if t.value == '=' else t.value
        if t.kind == 'cmd' and t.value in RELATION_CMDS:
            self.advance()
            return RELATION_CMDS[t.value]
        return None

    def parse_expr(self):
        if self.tok.is_sym('+'):
            self.advance()
        if self.tok.is_sym('-'):
            self.advance()
            left = -self.parse_term()
        else:
            left = self.parse_term()
        while True:
            t = self.tok
            if t.is_sym('+'):
                self.advance()
                left = left + self.parse_term()
            elif t.is_sym('-'):
                self.advance()
                left = left - self.parse_term()
            elif t.is_cmd('pm', 'mp'):
                self.error("± is not supported; write the two cases as separate cells")
            else:
                return left

    def stops_implicit(self):
        """True if the current token cannot start an implicitly multiplied factor."""
        t = self.tok
        if t.kind == 'eof':
            return True
        if t.kind == 'sym':
            if t.value in ('+', '-', '=', '<', '>', '<=', '>=', '!=', ',', ')', ']', '}', '&',
                           '\\\\', '^', '_', '!', "'", '/', '*', ';', ':'):
                return True
            if t.value == '|' and self.abs_depth > 0:
                return True
            if t.value == '‖' and self.norm_depth > 0:
                return True
        if t.kind == 'cmd' and (t.value in RELATION_CMDS or t.value in MUL_CMDS or
                                t.value in ('div', 'to', 'pm', 'mp', 'end')):
            return True
        if t.kind == 'end':
            return True
        if self.int_frames and self.at_differential():
            return True
        return False

    def at_differential(self, k=0):
        t = self.peek(k)
        if t.kind != 'letter' or t.value != 'd':
            return False
        return self.at_ident_start(k + 1)

    def parse_term(self):
        left = self.parse_unary()
        while True:
            t = self.tok
            if t.is_sym('*') or (t.kind == 'cmd' and t.value in MUL_CMDS):
                self.advance()
                right = self.parse_unary()
                left = _multiply(left, right, cross=(t.value == 'times'), dot=(t.value == 'cdot'))
            elif t.is_sym('/') or t.is_cmd('div'):
                self.advance()
                right = self.parse_unary()
                left = left / right
            elif not self.stops_implicit():
                right = self.parse_unary()
                left = _multiply(left, right)
            else:
                return left

    def parse_unary(self):
        if self.tok.is_sym('-'):
            self.advance()
            return -self.parse_unary()
        if self.tok.is_sym('+'):
            self.advance()
            return self.parse_unary()
        return self.parse_power()

    def parse_power(self):
        base = self.parse_postfix()
        if self.tok.is_sym('^'):
            self.advance()
            exp_toks = self.read_group_tokens()
            base = self.apply_exponent(base, exp_toks)
            base = self.parse_factorials(base)
        return base

    def apply_exponent(self, base, exp_toks):
        if len(exp_toks) == 1 and exp_toks[0].is_cmd('circ'):
            return base * sp.pi / 180
        if len(exp_toks) == 1 and (exp_toks[0].is_cmd('top', 'intercal') or
                                   (exp_toks[0].kind == 'letter' and exp_toks[0].value == 'T'
                                    and isinstance(base, sp.MatrixBase))):
            if not isinstance(base, sp.MatrixBase):
                self.error("Transpose ^T needs a matrix")
            return base.T
        if exp_toks and all(t.is_cmd('prime') for t in exp_toks):
            self.error("Primes are only supported directly after a function name, e.g. f'(x) or y''")
        exponent = self.parse_tokens(exp_toks, 'exponent')
        return _power(base, exponent)

    def parse_factorials(self, val):
        while self.tok.is_sym('!'):
            self.advance()
            val = sp.factorial(val)
        return val

    def parse_postfix(self):
        val = self.parse_primary()
        return self.parse_factorials(val)

    # ----- primaries -------------------------------------------------------
    def parse_primary(self):
        t = self.tok
        k = t.kind
        if k == 'num':
            self.advance()
            return _number(t.value)
        if k == 'sym':
            if t.value == '(':
                return self.parse_paren('(', ')')
            if t.value == '[':
                return self.parse_bracket_list()
            if t.value == '{':
                toks = self.read_group_tokens()
                return self.parse_tokens(toks, 'group')
            if t.value == '|':
                return self.parse_abs('|', 'abs_depth', sp.Abs)
            if t.value == '‖':
                return self.parse_abs('‖', 'norm_depth', _norm)
            if t.value == '%':
                return self.parse_out_ref()
            self.error(f"Unexpected '{t.value}'")
        if k == 'letter':
            if t.diff:
                self.error("Unexpected differential 'd' (only allowed at the end of an integral)")
            return self.parse_identifier()
        if k == 'word':
            return self.parse_identifier()
        if k == 'begin':
            return self.parse_matrix_env()
        if k == 'cmd':
            return self.parse_command()
        if k == 'eof':
            self.error("Expression is incomplete")
        self.error(f"Unexpected '{t.value}'")

    def parse_paren(self, open_ch, close_ch):
        self.expect_sym(open_ch)
        saved = (self.abs_depth, self.norm_depth)
        self.abs_depth = self.norm_depth = 0
        items = [self.parse_relation()]
        while self.tok.is_sym(','):
            self.advance()
            items.append(self.parse_relation())
        # also accept a mismatched closing bracket from half-open intervals
        if not self.tok.is_sym(close_ch):
            self.error(f"Missing '{close_ch}'")
        self.advance()
        self.abs_depth, self.norm_depth = saved
        if len(items) == 1:
            return items[0]
        return sp.Tuple(*items)

    def parse_call_args(self):
        """Parse '(a, b, ...)' and return the list of arguments."""
        self.expect_sym('(')
        saved = (self.abs_depth, self.norm_depth)
        self.abs_depth = self.norm_depth = 0
        args = [self.parse_relation()]
        while self.tok.is_sym(','):
            self.advance()
            args.append(self.parse_relation())
        self.expect_sym(')')
        self.abs_depth, self.norm_depth = saved
        return args

    def parse_bracket_list(self):
        self.expect_sym('[')
        saved = (self.abs_depth, self.norm_depth)
        self.abs_depth = self.norm_depth = 0
        items = [self.parse_expr()]
        while self.tok.is_sym(','):
            self.advance()
            items.append(self.parse_expr())
        self.expect_sym(']')
        self.abs_depth, self.norm_depth = saved
        if len(items) == 1 and isinstance(items[0], sp.MatrixBase):
            return items[0]   # \left[\begin{matrix}...\end{matrix}\right]
        if all(isinstance(it, sp.MatrixBase) and it.shape[1] == 1 for it in items):
            return sp.Matrix([list(it) for it in items])
        return sp.Matrix(items)

    def parse_abs(self, ch, depth_attr, fn):
        self.advance()
        setattr(self, depth_attr, getattr(self, depth_attr) + 1)
        inner = self.parse_expr()
        if not self.tok.is_sym(ch):
            self.error(f"Missing closing '{ch}'")
        self.advance()
        setattr(self, depth_attr, getattr(self, depth_attr) - 1)
        return fn(inner)

    def parse_out_ref(self):
        self.advance()
        if self.ctx.out_ref is None:
            self.error("Output references (%) are not available here")
        if self.tok.kind == 'num' and re.fullmatch(r'\d+', self.tok.value):
            idx = int(self.advance().value)
        else:
            if self.ctx.latest_idx is None:
                self.error("'%' refers to the previous output, but nothing has been evaluated yet")
            idx = self.ctx.latest_idx
        return self.ctx.out_ref(idx)

    def parse_identifier(self):
        name = self.read_identifier_name()
        # function name followed by primes: f'(x), y''
        primes = 0
        while self.tok.is_sym("'") or (self.tok.is_sym('^') and self._exponent_is_primes()):
            if self.tok.is_sym("'"):
                self.advance()
                primes += 1
            else:
                self.advance()
                primes += len(self.read_group_tokens())
        # word/known functions
        if name in self.ctx.functions:
            if self.tok.is_sym('('):
                args = self.parse_call_args()
                return self.apply_user_function(name, args, primes)
            if primes:
                self.error(f"Write {name}'(x) with an argument")
            return self.resolve_name(name)
        if name in self.ctx.dependent:
            indep = self.ctx.dependent[name]
            fn = sp.Function(name)
            if self.tok.is_sym('('):
                args = self.parse_call_args()
                if primes:
                    if len(args) != 1:
                        self.error(f"{name}' takes one argument")
                    return sp.Derivative(fn(indep), (indep, primes)).subs(indep, args[0])
                return fn(*args)
            base = fn(indep)
            return sp.Derivative(base, (indep, primes)) if primes else base
        if primes:
            self.error(f"'{name}' is not a known function, so {name}' is ambiguous. Define it first, e.g. {name}(x) = ...")
        if name in WORD_FUNCS and self.lookup_bound(name) is None and name not in self.ctx.values:
            return self.apply_builtin(WORD_FUNCS[name], name)
        val = self.resolve_name(name)
        if self.tok.is_sym('(') and isinstance(val, sp.Symbol) and self._looks_like_undefined_call(name):
            args = self.parse_call_args()
            self.ctx.warn(f"'{name}(…)' was read as an undefined function {name}(…). "
                          f"Define it first (e.g. {name}(x) = …) or write {name}\\cdot(…) for a product.")
            return sp.Function(name)(*args)
        return val

    def _exponent_is_primes(self):
        nxt = self.peek(1)
        if nxt.is_cmd('prime'):
            return True
        if nxt.is_sym('{'):
            j = self.i + 2
            seen = False
            while self.toks[j].is_cmd('prime'):
                seen = True
                j += 1
            return seen and self.toks[j].is_sym('}')
        return False

    def _looks_like_undefined_call(self, name):
        if name in self.ctx.values or name in self.ctx.symbols or self.lookup_bound(name) is not None:
            return False
        return name not in ('e', 'i', 'E', 'I')

    def apply_user_function(self, name, args, primes=0):
        fn = self.ctx.functions[name]
        if primes:
            params = getattr(fn, 'params', None)
            if not params or len(params) != 1:
                self.error(f"{name}' needs a single-variable function")
            body = fn(*params)
            return sp.diff(body, params[0], primes).subs(params[0], args[0])
        return fn(*args)

    def parse_command(self):
        t = self.tok
        name = t.value
        if name in GREEK:
            if name == 'Gamma' and self.peek().is_sym('('):
                self.advance()
                args = self.parse_call_args()
                return sp.gamma(*args)
            return self.parse_identifier()
        if name == 'pi':
            self.advance()
            return self.resolve_name('pi') if 'pi' in self.ctx.values else sp.pi
        if name == 'infty':
            self.advance()
            return sp.oo
        if name == 'exponentialE':
            self.advance()
            return sp.E
        if name == 'imaginaryI':
            self.advance()
            return sp.I
        if name in ('frac', 'dfrac', 'tfrac', 'cfrac'):
            return self.parse_frac()
        if name == 'binom':
            self.advance()
            a = self.read_arg('binomial top')
            b = self.read_arg('binomial bottom')
            return sp.binomial(a, b)
        if name == 'sqrt':
            return self.parse_sqrt()
        if name in FUNC_CMDS:
            return self.parse_func_cmd()
        if name in ('int', 'oint'):
            return self.parse_integral()
        if name in ('iint', 'iiint'):
            self.error("Write multiple integrals as nested \\int ... \\int ... dy dx")
        if name in ('sum', 'prod'):
            return self.parse_sum_prod()
        if name == 'lim':
            return self.parse_limit()
        if name in DECORATION_CMDS:
            self.advance()
            toks = self.read_group_tokens()
            return self.parse_tokens(toks, f'\\{name}{{…}}')
        if name == 'placeholder':
            self.advance()
            if self.tok.is_sym('['):
                while not self.tok.is_sym(']') and self.tok.kind != 'eof':
                    self.advance()
                self.advance()
            toks = self.read_group_tokens() if self.tok.is_sym('{') else []
            if not toks:
                self.error("An input slot is still empty")
            return self.parse_tokens(toks, 'slot')
        if name in ('partial', 'nabla'):
            self.error(f"\\{name} on its own is not supported here; use \\frac{{\\partial}}{{\\partial x}} or the vector operations")
        if name in ('cdots', 'ldots', 'dots'):
            self.error("'…' cannot be evaluated; write the sum with \\sum")
        self.error(f"Unsupported command \\{name}")

    def parse_frac(self):
        frac_tok = self.advance()
        num_toks = self.read_group_tokens()
        den_toks = self.read_group_tokens()
        deriv = self.match_derivative(num_toks, den_toks)
        if deriv is not None:
            return deriv
        # \int \frac{dx}{x}: the differential sits in the numerator
        if self.int_frames and num_toks and len(num_toks) >= 2:
            j = len(num_toks) - 2
            if num_toks[j].kind == 'letter' and num_toks[j].value == 'd' and \
               (num_toks[j + 1].kind == 'letter' or num_toks[j + 1].is_cmd(*GREEK)) and \
               self.int_frames[-1].differential is None:
                self.int_frames[-1].differential = GREEK.get(num_toks[j + 1].value, num_toks[j + 1].value)
                rest = num_toks[:j]
                num = self.parse_tokens(rest, 'numerator') if rest else sp.Integer(1)
                return num / self.parse_tokens(den_toks, 'denominator')
        num = self.parse_tokens(num_toks, 'numerator')
        den = self.parse_tokens(den_toks, 'denominator')
        return num / den

    def match_derivative(self, num, den):
        """Recognise d/dx, d^n y/dx^n, ∂^2/∂x∂y, ∂f/∂x ...  Returns a SymPy object or None."""
        if not num or not den:
            return None
        first = num[0]
        is_d = first.kind == 'letter' and first.value == 'd'
        is_partial = first.is_cmd('partial')
        if not (is_d or is_partial):
            return None
        # numerator: d [^n] [f]
        j = 1
        order = 1
        if j < len(num) and num[j].is_sym('^'):
            sub = self.sub(num[j + 1:])
            otoks = sub.read_group_tokens()
            if len(otoks) != 1 or otoks[0].kind != 'num':
                return None
            order = int(otoks[0].value)
            j = j + 1 + sub.i
        fname_toks = num[j:]
        # denominator: sequence of (d|∂) var [^n]
        variables = []
        k = 0
        while k < len(den):
            dt = den[k]
            ok_d = (dt.kind == 'letter' and dt.value == 'd') if is_d else dt.is_cmd('partial')
            if not ok_d:
                return None
            k += 1
            if k >= len(den):
                return None
            vt = den[k]
            if vt.kind == 'letter':
                vname = vt.value
            elif vt.kind == 'cmd' and vt.value in GREEK:
                vname = GREEK[vt.value]
            else:
                return None
            k += 1
            if k < len(den) and den[k].is_sym('_'):
                sub = self.sub(den[k + 1:])
                vname = vname + '_' + sub.read_subscript_name()
                k += 1 + sub.i
            vorder = 1
            if k < len(den) and den[k].is_sym('^'):
                sub = self.sub(den[k + 1:])
                otoks = sub.read_group_tokens()
                if len(otoks) != 1 or otoks[0].kind != 'num':
                    return None
                vorder = int(otoks[0].value)
                k += 1 + sub.i
            variables.append((vname, vorder))
        if not variables:
            return None
        total = sum(o for _, o in variables)
        if total != order:
            self.ctx.warn(f"Derivative order mismatch: numerator says {order}, denominator says {total}; using the denominator.")
        var_syms = [(self.symbol_for(v), o) for v, o in variables]
        bound = {str(s): s for s, _ in var_syms}
        if fname_toks:
            # d y / d x  (y applied to the differentiation variables)
            target = self.derivative_target(fname_toks, var_syms)
            return sp.Derivative(target, *var_syms)
        # operator form: d/dx (...)
        self.scopes.append(bound)
        try:
            operand = self.parse_operator_operand()
        finally:
            self.scopes.pop()
        return sp.Derivative(operand, *var_syms)

    def derivative_target(self, toks, var_syms):
        sub = self.sub(toks)
        if sub.at_ident_start() and (len(toks) == 1 or (len(toks) > 1 and toks[1].is_sym('_'))):
            name = sub.read_identifier_name(greedy_known=False)
            if sub.tok.kind == 'eof':
                if name in self.ctx.functions:
                    fn = self.ctx.functions[name]
                    params = getattr(fn, 'params', None) or [s for s, _ in var_syms]
                    return fn(*params)
                if name in self.ctx.dependent:
                    return sp.Function(name)(self.ctx.dependent[name])
                val = self.ctx.values.get(name)
                if val is not None and not isinstance(val, sp.Symbol):
                    return val
                # an otherwise unknown y in dy/dx is an implicit function y(x)
                return sp.Function(name)(*[s for s, _ in var_syms])
        return self.parse_tokens(toks, 'derivative numerator')

    def parse_operator_operand(self):
        """Operand of a prefix operator (d/dx, \\sum, \\lim).

        A parenthesised operand stops at its ')' plus any implicitly multiplied factors;
        otherwise the operand extends over the rest of the additive expression."""
        if self.tok.is_sym('('):
            return self.parse_term()
        return self.parse_expr()

    def parse_sqrt(self):
        self.advance()
        if self.tok.is_sym('['):
            self.advance()
            start = self.i
            depth = 0
            while not (self.tok.is_sym(']') and depth == 0):
                if self.tok.kind == 'eof':
                    self.error("Missing ']' in root index")
                if self.tok.is_sym('['):
                    depth += 1
                if self.tok.is_sym(']'):
                    depth -= 1
                self.advance()
            deg = self.parse_tokens(self.toks[start:self.i], 'root index')
            self.advance()
            body = self.read_arg('radicand')
            return sp.root(body, deg)
        return sp.sqrt(self.read_arg('radicand'))

    def parse_func_cmd(self):
        t = self.advance()
        fn = FUNC_CMDS[t.value]
        base = None
        power = None
        if t.value == 'log' and self.tok.is_sym('_'):
            self.advance()
            base = self.read_arg('log base')
        if self.tok.is_sym('^'):
            self.advance()
            power = self.parse_tokens(self.read_group_tokens(), 'function power')
            if base is None and t.value == 'log' and self.tok.is_sym('_'):
                self.advance()
                base = self.read_arg('log base')
        if power == -1 and fn in INVERSE_FUNCS:
            fn, power = INVERSE_FUNCS[fn], None
        arg_list = self.parse_function_argument()
        if base is not None:
            val = sp.log(arg_list[0], base)
        else:
            val = fn(*arg_list)
        return _power(val, power) if power is not None else val

    def apply_builtin(self, fn, name):
        power = None
        if self.tok.is_sym('^'):
            self.advance()
            power = self.parse_tokens(self.read_group_tokens(), 'function power')
            if power == -1 and fn in INVERSE_FUNCS:
                fn, power = INVERSE_FUNCS[fn], None
        args = self.parse_function_argument()
        val = fn(*args)
        return _power(val, power) if power is not None else val

    def parse_function_argument(self):
        """\\sin(x) | \\sin x | \\sin 2x | \\sin x^2 ;  \\sin x \\cos x -> sin(x)*cos(x)."""
        if self.tok.is_sym('('):
            return self.parse_call_args()
        if self.stops_implicit():
            self.error("Function is missing its argument")
        val = self.parse_unary()
        while not self.stops_implicit():
            t = self.tok
            if t.kind == 'cmd' and (t.value in FUNC_CMDS or t.value in BIG_OPS):
                break
            if t.kind == 'cmd' and t.value in ('frac', 'dfrac', 'tfrac') and self._frac_is_derivative():
                break
            if t.is_sym('('):
                break
            val = _multiply(val, self.parse_power())
        return [val]

    def _frac_is_derivative(self):
        nxt = self.peek(1)
        nxt2 = self.peek(2)
        return nxt.is_sym('{') and ((nxt2.kind == 'letter' and nxt2.value == 'd') or nxt2.is_cmd('partial'))

    # ----- big operators ---------------------------------------------------
    def read_limits(self):
        lower = upper = None
        for _ in range(2):
            if self.tok.is_sym('_') and lower is None:
                self.advance()
                lower = self.read_group_tokens()
            elif self.tok.is_sym('^') and upper is None:
                self.advance()
                upper = self.read_group_tokens()
        return lower, upper

    def prescan_differential(self):
        """Name of the differential variable that closes the integral starting here."""
        depth = 1
        j = self.i
        toks = self.toks
        while toks[j].kind != 'eof':
            t = toks[j]
            if t.kind == 'cmd' and t.value in ('int', 'oint'):
                depth += 1
            elif t.kind == 'letter' and t.value == 'd':
                nt = toks[j + 1]
                if (nt.kind == 'letter' and not nt.diff) or (nt.kind == 'cmd' and nt.value in GREEK):
                    depth -= 1
                    if depth == 0:
                        return GREEK.get(nt.value, nt.value)
            j += 1
        return None

    def parse_integral(self):
        self.advance()
        lower_t, upper_t = self.read_limits()
        if (lower_t is None) != (upper_t is None):
            self.error("A definite integral needs both a lower and an upper limit")
        var_name = self.prescan_differential()
        frame = _IntFrame(var_name)
        bound = {var_name: self.symbol_for(var_name)} if var_name else {}
        self.int_frames.append(frame)
        self.scopes.append(bound)
        try:
            if self.at_differential():
                integrand = sp.Integer(1)
            else:
                integrand = self.parse_expr()
        finally:
            self.scopes.pop()
            self.int_frames.pop()
        if self.at_differential():
            self.advance()
            var_name = self.read_identifier_name(greedy_known=None)
        elif frame.differential:
            var_name = frame.differential
        else:
            free = sorted(getattr(sp.sympify(integrand), 'free_symbols', set()), key=str)
            if len(free) == 1:
                var_name = str(free[0])
                self.ctx.warn(f"Integral has no differential; integrating with respect to {var_name}. Add d{var_name} to be explicit.")
            else:
                self.error("Integral is missing its differential (e.g. dx)")
        var = self.symbol_for(var_name)
        if lower_t is not None:
            a = self.parse_tokens(lower_t, 'lower limit')
            b = self.parse_tokens(upper_t, 'upper limit')
            return sp.Integral(integrand, (var, a, b))
        return sp.Integral(integrand, var)

    def parse_sum_prod(self):
        op = self.advance().value
        lower_t, upper_t = self.read_limits()
        if lower_t is None or upper_t is None:
            self.error(f"\\{op} needs limits like _{{n=1}}^{{\\infty}}")
        eq_idx = next((k for k, t in enumerate(lower_t) if t.is_sym('=')), None)
        if eq_idx is None or eq_idx == 0:
            self.error(f"\\{op} lower limit must look like n=1")
        sub = self.sub(lower_t[:eq_idx])
        idx_name = sub.read_identifier_name(greedy_known=False)
        idx = self.symbol_for(idx_name)
        if idx_name not in self.ctx.symbols and idx_name not in self.ctx.values:
            idx = sp.Symbol(idx_name, integer=True)
        a = self.parse_tokens(lower_t[eq_idx + 1:], 'lower limit')
        b = self.parse_tokens(upper_t, 'upper limit')
        self.scopes.append({idx_name: idx})
        try:
            body = self.parse_operator_operand()
        finally:
            self.scopes.pop()
        cls = sp.Sum if op == 'sum' else sp.Product
        return cls(body, (idx, a, b))

    def parse_limit(self):
        self.advance()
        if not self.tok.is_sym('_'):
            self.error("\\lim needs a subscript like _{x \\to 0}")
        self.advance()
        sub_toks = self.read_group_tokens()
        to_idx = next((k for k, t in enumerate(sub_toks) if t.is_cmd('to', 'rightarrow', 'longrightarrow')
                       or t.is_sym('→')), None)
        if to_idx is None:
            self.error("\\lim subscript must look like x \\to a")
        var_name = self.sub(sub_toks[:to_idx]).read_identifier_name(greedy_known=False)
        pt_toks = list(sub_toks[to_idx + 1:])
        direction = '+-'
        # trailing ^{+} / ^{-} / ^+ / ^-
        if len(pt_toks) >= 2 and pt_toks[-1].is_sym('+', '-') and pt_toks[-2].is_sym('^'):
            direction = pt_toks[-1].value
            pt_toks = pt_toks[:-2]
        elif len(pt_toks) >= 4 and pt_toks[-1].is_sym('}') and pt_toks[-2].is_sym('+', '-') \
                and pt_toks[-3].is_sym('{') and pt_toks[-4].is_sym('^'):
            direction = pt_toks[-2].value
            pt_toks = pt_toks[:-4]
        point = self.parse_tokens(pt_toks, 'limit point')
        var = self.symbol_for(var_name)
        self.scopes.append({var_name: var})
        try:
            body = self.parse_operator_operand()
        finally:
            self.scopes.pop()
        if direction == '+-' and point in (sp.oo, -sp.oo):
            direction = '-' if point == sp.oo else '+'
        return sp.Limit(body, var, point, dir=direction)

    def parse_matrix_env(self):
        env = self.advance().value
        rows = [[]]
        cell = []
        depth = 0
        while True:
            t = self.tok
            if t.kind == 'eof':
                self.error(f"Missing \\end{{{env}}}")
            if t.kind == 'begin':
                depth += 1
            if t.kind == 'end':
                if depth == 0:
                    self.advance()
                    break
                depth -= 1
            if depth == 0 and t.is_sym('&'):
                rows[-1].append(cell)
                cell = []
                self.advance()
                continue
            if depth == 0 and t.is_sym('\\\\'):
                rows[-1].append(cell)
                cell = []
                rows.append([])
                self.advance()
                continue
            cell.append(t)
            self.advance()
        rows[-1].append(cell)
        rows = [r for r in rows if any(c for c in r)]
        values = [[self.parse_tokens(c, 'matrix entry') for c in r] for r in rows]
        width = {len(r) for r in values}
        if len(width) != 1:
            self.error("Matrix rows have different lengths")
        if env in ('vmatrix', 'Vmatrix'):
            return sp.Matrix(values).det()
        return sp.Matrix(values)


# ---------------------------------------------------------------------------
# Arithmetic helpers
# ---------------------------------------------------------------------------

def _number(txt):
    if re.fullmatch(r'\d+', txt):
        return sp.Integer(txt)
    return sp.Float(txt)


def _is_vec3(v):
    return isinstance(v, sp.MatrixBase) and v.shape in ((3, 1), (1, 3))


def _multiply(a, b, cross=False, dot=False):
    if cross and _is_vec3(a) and _is_vec3(b):
        return sp.Matrix(a).cross(sp.Matrix(b)).reshape(3, 1) if a.shape == (3, 1) else sp.Matrix(a).cross(sp.Matrix(b))
    if dot and isinstance(a, sp.MatrixBase) and isinstance(b, sp.MatrixBase) and \
            1 in a.shape and 1 in b.shape and len(a) == len(b):
        return sp.Matrix(a).dot(sp.Matrix(b))
    return a * b


def _power(base, exponent):
    if isinstance(base, sp.MatrixBase):
        return base ** exponent
    return sp.Pow(base, exponent)


def _norm(v):
    return v.norm() if isinstance(v, sp.MatrixBase) else sp.Abs(v)


def _make_rel(op, a, b):
    if op == '==':
        return sp.Eq(a, b, evaluate=False)
    return {'<': sp.Lt, '>': sp.Gt, '<=': sp.Le, '>=': sp.Ge, '!=': sp.Ne}[op](a, b, evaluate=False)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _prep(src):
    if src is None:
        raise LatexParseError("Input is empty.")
    src = str(src).strip()
    if not src:
        raise LatexParseError("Input is empty.")
    return src


def parse_latex_expr(src, ctx=None):
    """Parse LaTeX (or simple plain-text math) into an unevaluated SymPy object.

    Relations (=, <, \\le, ...) become Eq/Lt/... objects.  Calculus operators stay
    unevaluated (Integral, Derivative, Sum, Product, Limit); call .doit() to evaluate.
    """
    ctx = ctx or ParseContext()
    src = _prep(src)
    p = _Parser(tokenize(src), ctx, src=src)
    val = p.parse_relation()
    if p.tok.kind != 'eof':
        p.error(f"Unexpected '{p.tok.value}'")
    return val


def _top_level_eq_index(toks):
    depth = 0
    abs_open = False
    hits = []
    for k, t in enumerate(toks):
        if t.kind == 'sym' and t.value in '([{':
            depth += 1
        elif t.kind == 'sym' and t.value in ')]}':
            depth -= 1
        elif t.kind == 'begin':
            depth += 1
        elif t.kind == 'end':
            depth -= 1
        elif t.is_sym('|'):
            abs_open = not abs_open
        elif depth == 0 and not abs_open and t.is_sym('='):
            hits.append(k)
    return hits


def parse_latex_statement(src, ctx=None, allow_definitions=True):
    """Parse a cell: ``f(x, y) = body`` (definition), ``name = expr`` (assignment) or an expression."""
    ctx = ctx or ParseContext()
    src = _prep(src)
    toks = tokenize(src)
    eqs = _top_level_eq_index(toks)
    if allow_definitions and len(eqs) == 1:
        lhs = toks[:eqs[0]]
        rhs = toks[eqs[0] + 1:-1]
        p = _Parser(lhs + [Tok('eof', '', toks[eqs[0]].pos)], ctx, src=src)
        if lhs and p.at_ident_start():
            try:
                name = p.read_identifier_name(greedy_known=False)
            except LatexParseError:
                name = None
            if name:
                # name(args) = ...
                if p.tok.is_sym('(') and name not in ctx.dependent:
                    p.advance()
                    arg_names = []
                    ok = True
                    while True:
                        if not p.at_ident_start():
                            ok = False
                            break
                        arg_names.append(p.read_identifier_name(greedy_known=False))
                        if p.tok.is_sym(','):
                            p.advance()
                            continue
                        break
                    if ok and p.tok.is_sym(')') and p.peek().kind == 'eof' and arg_names:
                        args = [p.symbol_for(a) for a in arg_names]
                        body_p = _Parser(rhs + [Tok('eof', '', len(src))], ctx, src=src)
                        body_p.scopes.append({a: s for a, s in zip(arg_names, args)})
                        body = body_p.parse_relation()
                        if body_p.tok.kind != 'eof':
                            body_p.error(f"Unexpected '{body_p.tok.value}'")
                        return Statement('funcdef', body, name=name, args=args)
                elif p.tok.kind == 'eof' and name not in ctx.dependent and name not in ('e', 'i', 'pi'):
                    expr = parse_latex_expr(src[toks[eqs[0]].pos + 1:], ctx)
                    return Statement('assign', expr, name=name)
    return Statement('expr', parse_latex_expr(src, ctx))


# ---------------------------------------------------------------------------
# Python code generation
# ---------------------------------------------------------------------------

_PY_KEYWORDS = {'lambda', 'def', 'class', 'if', 'else', 'for', 'while', 'in', 'is', 'not', 'and',
                'or', 'pass', 'return', 'import', 'from', 'as', 'with', 'yield', 'global', 'try',
                'except', 'finally', 'raise', 'del', 'assert', 'break', 'continue', 'None', 'True',
                'False', 'nonlocal', 'async', 'await'}
# Names that would shadow SymPy objects in generated code
_SHADOWED = {'E', 'I', 'S', 'N', 'O', 'Q', 'pi', 'sp', 'oo'}


def python_name(name):
    """A valid Python identifier for a SymPy symbol name (lambda -> lam, a_{n+1} -> a_n_1)."""
    if name == 'lambda':
        return 'lam'
    clean = re.sub(r'[^0-9A-Za-z_]+', '_', name).strip('_') or 'v'
    if clean[0].isdigit():
        clean = 'v_' + clean
    if clean in _PY_KEYWORDS:
        clean += '_'
    return clean


class _CodePrinter(sp.printing.str.StrPrinter):
    def __init__(self, renames):
        super().__init__({'order': None})
        self.renames = renames

    def _print_Symbol(self, expr):
        return self.renames.get(expr, expr.name)

    def _print_Exp1(self, expr):
        return 'sp.E'

    def _print_ImaginaryUnit(self, expr):
        return 'sp.I'

    def _print_Rational(self, expr):
        return f"sp.Rational({expr.p}, {expr.q})"

    def _print_Pi(self, expr):
        return 'sp.pi'

    def _print_Infinity(self, expr):
        return 'sp.oo'

    def _print_NegativeInfinity(self, expr):
        return '-sp.oo'

    def _print_Integral(self, expr):
        lims = []
        for lim in expr.limits:
            if len(lim) == 1:
                lims.append(self._print(lim[0]))
            else:
                lims.append('(' + ', '.join(self._print(x) for x in lim) + ')')
        return f"sp.Integral({self._print(expr.function)}, {', '.join(lims)})"

    def _print_Derivative(self, expr):
        parts = []
        for v, n in expr.variable_count:
            parts.append(self._print(v) if n == 1 else f"({self._print(v)}, {n})")
        return f"sp.Derivative({self._print(expr.expr)}, {', '.join(parts)})"

    def _print_Sum(self, expr):
        lims = ', '.join('(' + ', '.join(self._print(x) for x in lim) + ')' for lim in expr.limits)
        return f"sp.Sum({self._print(expr.function)}, {lims})"

    def _print_Product(self, expr):
        lims = ', '.join('(' + ', '.join(self._print(x) for x in lim) + ')' for lim in expr.limits)
        return f"sp.Product({self._print(expr.function)}, {lims})"

    def _print_Limit(self, expr):
        e, z, z0, d = expr.args
        return f"sp.Limit({self._print(e)}, {self._print(z)}, {self._print(z0)}, dir='{d}')"

    def _print_MutableDenseMatrix(self, expr):
        return 'sp.Matrix(' + self._print(expr.tolist()) + ')'

    _print_ImmutableDenseMatrix = _print_MutableDenseMatrix
    _print_Matrix = _print_MutableDenseMatrix

    def _print_Function(self, expr):
        name = expr.func.__name__
        if isinstance(expr.func, sp.core.function.UndefinedFunction):
            name = python_name(name)
        elif hasattr(sp, name):
            name = 'sp.' + name
        return name + '(' + ', '.join(self._print(a) for a in expr.args) + ')'

    def _print_Equality(self, expr):
        return f"sp.Eq({self._print(expr.lhs)}, {self._print(expr.rhs)})"


def symbol_renames(expr):
    """Map each free Symbol to the Python name used for it in generated code."""
    syms = sorted(getattr(expr, 'free_symbols', set()) |
                  {s for s in sp.preorder_traversal(expr) if isinstance(s, sp.Symbol)} if
                  isinstance(expr, (sp.Basic, sp.MatrixBase)) else set(), key=str)
    renames = {}
    used = set()
    for s in syms:
        nm = python_name(s.name)
        if nm in _SHADOWED:
            nm = nm + '_'
        base, k = nm, 2
        while nm in used:
            nm = f"{base}{k}"
            k += 1
        used.add(nm)
        renames[s] = nm
    return renames


def to_code(expr, renames=None):
    """Valid Python/SymPy source for a parsed expression (symbols must be declared separately)."""
    if isinstance(expr, (list, tuple)):
        return '[' + ', '.join(to_code(e, renames) for e in expr) + ']'
    if renames is None:
        renames = symbol_renames(expr)
    return _CodePrinter(renames).doprint(expr)


def symbol_declarations(exprs):
    """Lines declaring every symbol and undefined function used by ``exprs`` (with assumptions)."""
    syms = set()
    funcs = set()
    for e in exprs:
        if isinstance(e, (sp.Basic, sp.MatrixBase)):
            for node in sp.preorder_traversal(e):
                if isinstance(node, sp.Symbol):
                    syms.add(node)
                elif isinstance(node, sp.core.function.AppliedUndef):
                    funcs.add(node.func.__name__)
    renames = {}
    lines = []
    for s in sorted(syms, key=str):
        nm = python_name(s.name)
        if nm in _SHADOWED:
            nm += '_'
        renames[s] = nm
        assumptions = {k: v for k, v in s.assumptions0.items() if v}
        kw = ''.join(f", {k}=True" for k in sorted(assumptions) if k in ('positive', 'real', 'integer', 'nonzero', 'nonnegative', 'negative'))
        lines.append(f"{nm} = sp.Symbol({s.name!r}{kw})")
    for f in sorted(funcs):
        lines.append(f"{python_name(f)} = sp.Function({f!r})")
    return lines, renames
