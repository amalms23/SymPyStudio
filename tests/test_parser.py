"""Regression tests for kernel/latex_parser.py: LaTeX (as MathLive emits it) -> SymPy.

Each case pins down what an input *means*.  When you change the parser, add the input
that motivated the change here first.
"""

import os
import sys
import unittest

import sympy as sp

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'kernel'))
from latex_parser import (  # noqa: E402
    LatexParseError, ParseContext, parse_latex_expr, parse_latex_statement, to_code, symbol_declarations,
)

x, y, z, t, n, a, b = sp.symbols('x y z t n a b')
E, I, L, P = sp.symbols('E I L P')
yf = sp.Function('y')


def parse(src, **ctx_kw):
    return parse_latex_expr(src, ParseContext(**ctx_kw))


def value(src, **ctx_kw):
    e = parse(src, **ctx_kw)
    return e.doit() if hasattr(e, 'doit') else e


class TestSymbolPolicy(unittest.TestCase):
    def test_E_and_I_are_symbols(self):
        # Cantilever tip deflection must not turn into a complex number
        self.assertEqual(parse(r'\frac{PL^3}{3EI}'), L**3 * P / (3 * E * I))
        self.assertEqual(parse(r'E\cdot I'), E * I)

    def test_e_is_euler_and_i_is_imaginary_by_default(self):
        self.assertEqual(parse(r'e^{i\pi}'), -1)
        self.assertEqual(parse(r'e^{x}'), sp.exp(x))

    def test_e_and_i_can_be_switched_off(self):
        e_s, i_s = sp.symbols('e i')
        self.assertEqual(parse(r'e^{i\pi}', euler_e=False, imaginary_i=False), e_s ** (i_s * sp.pi))

    def test_explicit_mathlive_constants(self):
        self.assertEqual(parse(r'\exponentialE^{\imaginaryI\pi}', euler_e=False, imaginary_i=False), -1)
        self.assertEqual(parse(r'\mathrm{e}^{x}', euler_e=False), sp.exp(x))

    def test_bound_index_beats_imaginary_unit(self):
        self.assertEqual(value(r'\sum_{i=1}^{n}i'), n ** 2 / 2 + n / 2)

    def test_lambda_is_a_symbol(self):
        self.assertEqual(parse(r'\lambda x'), sp.Symbol('lambda') * x)

    def test_greek_and_subscripts(self):
        self.assertEqual(parse(r'\varepsilon_0\mu_0'), sp.Symbol('epsilon_0') * sp.Symbol('mu_0'))
        self.assertEqual(parse(r'x_1+x_{12}'), sp.Symbol('x_1') + sp.Symbol('x_12'))
        self.assertEqual(parse(r'\sigma_{xx}'), sp.Symbol('sigma_xx'))

    def test_two_letter_greek_names_are_not_merged(self):
        nu_ = sp.Symbol('n') * sp.Symbol('u')
        self.assertEqual(parse('nu'), nu_)

    def test_unknown_words_split_with_warning(self):
        ctx = ParseContext()
        self.assertEqual(parse_latex_expr(r'mass\cdot a', ctx), sp.Symbol('m') * a ** 2 * sp.Symbol('s') ** 2)
        self.assertTrue(any('mass' in w for w in ctx.warnings))

    def test_known_session_names_are_merged(self):
        self.assertEqual(parse(r'mass\cdot a', values={'mass': sp.Integer(5)}), 5 * a)

    def test_mathrm_word_is_one_name(self):
        self.assertEqual(parse(r'\mathrm{mass}'), sp.Symbol('mass'))


class TestArithmetic(unittest.TestCase):
    def test_fractions_and_roots(self):
        self.assertEqual(parse(r'\frac{1}{3}+\frac{1}{6}'), sp.Rational(1, 2))
        self.assertEqual(parse(r'\frac12'), sp.Rational(1, 2))
        self.assertEqual(parse(r'\sqrt{8}'), 2 * sp.sqrt(2))
        self.assertEqual(parse(r'\sqrt[3]{8}'), 2)

    def test_implicit_multiplication_and_powers(self):
        self.assertEqual(parse(r'2x^2y'), 2 * x ** 2 * y)
        self.assertEqual(parse(r'x^{2}y^{2}'), x ** 2 * y ** 2)
        self.assertEqual(parse('1/2x'), x / 2)
        self.assertEqual(parse(r'-x^2'), -x ** 2)
        self.assertEqual(parse(r'2^{10}'), 1024)
        self.assertEqual(parse(r'2^{3^{2}}'), 512)

    def test_plain_text_fields(self):
        self.assertEqual(parse('2*pi'), 2 * sp.pi)
        self.assertEqual(parse('oo'), sp.oo)
        self.assertEqual(parse('-oo'), -sp.oo)
        self.assertEqual(parse('x**2'), x ** 2)
        self.assertEqual(parse('sqrt(2)'), sp.sqrt(2))

    def test_absolute_values(self):
        self.assertEqual(parse(r'\frac{1}{2}\left|x-\left|y\right|\right|'), sp.Abs(x - sp.Abs(y)) / 2)
        self.assertEqual(parse(r'\ln|x|'), sp.log(sp.Abs(x)))
        self.assertEqual(parse(r'\left\vert x\right\vert'), sp.Abs(x))

    def test_factorial_binomial_degrees(self):
        self.assertEqual(parse('5!'), 120)
        self.assertEqual(parse(r'\binom{5}{2}'), 10)
        self.assertEqual(parse(r'30^{\circ}'), sp.pi / 6)

    def test_relations(self):
        self.assertEqual(parse(r'x^2\le4'), sp.Le(x ** 2, 4))
        self.assertEqual(parse(r'x\geq 1'), sp.Ge(x, 1))
        self.assertEqual(parse(r'x\ne 1'), sp.Ne(x, 1))
        self.assertEqual(parse('x^2=4'), sp.Eq(x ** 2, 4))


class TestFunctions(unittest.TestCase):
    def test_trig_forms(self):
        self.assertEqual(parse(r'\sin\left(x\right)'), sp.sin(x))
        self.assertEqual(parse(r'\sin x\cos x'), sp.sin(x) * sp.cos(x))
        self.assertEqual(parse(r'\sin 2x'), sp.sin(2 * x))
        self.assertEqual(parse(r'\sin^2 x+\cos^2 x'), sp.sin(x) ** 2 + sp.cos(x) ** 2)
        self.assertEqual(parse(r'\sin^{-1}(x)'), sp.asin(x))
        self.assertEqual(parse(r'\arctan x'), sp.atan(x))

    def test_logs(self):
        self.assertEqual(parse(r'\log_{2}(8)'), 3)
        self.assertEqual(parse(r'\ln x'), sp.log(x))
        self.assertEqual(parse(r'\exp\left(x\right)'), sp.exp(x))

    def test_user_functions(self):
        class F:
            params = [x]

            def __call__(self, v):
                return (x ** 2 * sp.sin(x)).subs(x, v)
        f = F()
        self.assertEqual(parse(r'f(\pi)', functions={'f': f}), 0)
        self.assertEqual(parse(r"f'(x)", functions={'f': f}), sp.diff(x ** 2 * sp.sin(x), x))

    def test_undefined_function_call_warns(self):
        ctx = ParseContext()
        self.assertEqual(parse_latex_expr('h(t)', ctx), sp.Function('h')(t))
        self.assertTrue(ctx.warnings)

    def test_known_symbol_times_parenthesis(self):
        self.assertEqual(parse('x(x+1)', symbols={'x': x}), x * (x + 1))


class TestCalculus(unittest.TestCase):
    def test_leibniz_derivatives(self):
        self.assertEqual(parse(r'\frac{dy}{dx}'), sp.Derivative(yf(x), x))
        self.assertEqual(parse(r'\frac{d^{2}y}{dx^{2}}'), sp.Derivative(yf(x), (x, 2)))
        self.assertEqual(value(r'\frac{d}{dx}\left(\sin\left(x\right)\cos\left(x\right)\right)'),
                         sp.cos(x) ** 2 - sp.sin(x) ** 2)
        self.assertEqual(value(r'\frac{d}{dt}(t^3)+1'), 3 * t ** 2 + 1)

    def test_partial_derivatives(self):
        self.assertEqual(value(r'\frac{\partial^{2}}{\partial x\partial y}\left(x^2y^2\right)'), 4 * x * y)
        self.assertEqual(value(r'\frac{\partial^{2}}{\partial x^{2}}\left(x^3y\right)'), 6 * x * y)

    def test_ordinary_fraction_starting_with_d(self):
        d = sp.Symbol('d')
        self.assertEqual(parse(r'\frac{da}{2}'), d * a / 2)
        self.assertEqual(parse(r'\frac{d}{2}'), d / 2)

    def test_integrals(self):
        self.assertEqual(value(r'\int_{0}^{\pi}\sin\left(x\right)\cos\left(x\right)dx'), 0)
        self.assertEqual(value(r'\int x e^{x}\,\mathrm{d}x'), (x - 1) * sp.exp(x))
        self.assertEqual(value(r'\int_0^\infty e^{-x^2}dx'), sp.sqrt(sp.pi) / 2)
        self.assertEqual(value(r'\int\frac{dx}{x}'), sp.log(x))
        self.assertEqual(value(r'\int_{0}^{1}\int_{0}^{x}y\,dy\,dx'), sp.Rational(1, 6))
        self.assertEqual(value(r'\int^{1}_{0}x\,dx'), sp.Rational(1, 2))
        self.assertEqual(value(r'\int_0^{2\pi}\cos\theta\,d\theta'), 0)

    def test_integral_without_differential(self):
        ctx = ParseContext()
        self.assertEqual(parse_latex_expr(r'\int_0^1 x^2', ctx).doit(), sp.Rational(1, 3))
        self.assertTrue(ctx.warnings)
        with self.assertRaises(LatexParseError):
            parse(r'\int_0^1 xy')

    def test_integration_variable_is_bound(self):
        # x has a value in the session, but inside \int ... dx it is the integration variable
        self.assertEqual(value(r'\int_0^1 x\,dx', values={'x': sp.Integer(5)}), sp.Rational(1, 2))

    def test_sums_products_limits(self):
        self.assertEqual(value(r'\sum_{n=1}^{\infty}\frac{1}{n^2}'), sp.pi ** 2 / 6)
        self.assertEqual(value(r'\prod_{k=1}^{5}k'), 120)
        self.assertEqual(value(r'\lim_{x\to0}\frac{\sin x}{x}'), 1)
        self.assertEqual(value(r'\lim_{x\to0^{+}}\frac{1}{x}'), sp.oo)
        self.assertEqual(value(r'\lim_{x\to0^-}\frac{1}{x}'), -sp.oo)
        self.assertEqual(value(r'\lim_{x\to\infty}\frac{1}{x}'), 0)

    def test_operator_scope(self):
        # parenthesised operand stops at ')' ; otherwise the operand runs to the end of the sum
        self.assertEqual(value(r'\frac{d}{dx}(x^2)+3'), 2 * x + 3)
        self.assertEqual(value(r'\frac{d}{dx}x^2+3x'), 2 * x + 3)

    def test_ode_mode(self):
        dep = {'y': x}
        self.assertEqual(parse(r"y''+y=0", dependent=dep), sp.Eq(sp.Derivative(yf(x), (x, 2)) + yf(x), 0))
        self.assertEqual(parse(r"y^{\prime\prime}+y=0", dependent=dep), sp.Eq(sp.Derivative(yf(x), (x, 2)) + yf(x), 0))
        self.assertEqual(parse(r'\frac{dy}{dx}=y', dependent=dep), sp.Eq(sp.Derivative(yf(x), x), yf(x)))
        self.assertEqual(parse(r"y'(0)", dependent=dep), sp.Derivative(yf(x), x).subs(x, 0))


class TestMatrices(unittest.TestCase):
    def test_environments(self):
        self.assertEqual(parse(r'\begin{pmatrix}1&2\\3&4\end{pmatrix}'), sp.Matrix([[1, 2], [3, 4]]))
        self.assertEqual(parse(r'\begin{bmatrix}1&2\\3&4\end{bmatrix}^{-1}'), sp.Matrix([[1, 2], [3, 4]]).inv())
        self.assertEqual(parse(r'\begin{vmatrix}1&2\\3&4\end{vmatrix}'), -2)
        self.assertEqual(parse(r'\left[\begin{matrix}a\\b\end{matrix}\right]'), sp.Matrix([a, b]))
        self.assertEqual(parse(r'\begin{bmatrix}1&2\\3&4\end{bmatrix}^{T}'), sp.Matrix([[1, 3], [2, 4]]))

    def test_nested_entries(self):
        self.assertEqual(parse(r'\begin{pmatrix}\frac{1}{2}&\sqrt{4}\\x^{2}&\sin x\end{pmatrix}'),
                         sp.Matrix([[sp.Rational(1, 2), 2], [x ** 2, sp.sin(x)]]))

    def test_vectors(self):
        self.assertEqual(parse('[1,2,3]'), sp.Matrix([1, 2, 3]))
        self.assertEqual(parse(r'[1,2,3]\times[4,5,6]'), sp.Matrix([-3, 6, -3]))
        self.assertEqual(parse(r'[1,2,3]\cdot[4,5,6]'), 32)
        self.assertEqual(parse('[[1,2],[3,4]]'), sp.Matrix([[1, 2], [3, 4]]))


class TestStatements(unittest.TestCase):
    def test_function_definition(self):
        st = parse_latex_statement(r'f(x)=x^2\sin(x)')
        self.assertEqual((st.kind, st.name, st.args), ('funcdef', 'f', [x]))
        self.assertEqual(st.expr, x ** 2 * sp.sin(x))
        st2 = parse_latex_statement('g(x,y)=xy')
        self.assertEqual((st2.kind, st2.args, st2.expr), ('funcdef', [x, y], x * y))

    def test_function_arguments_are_bound(self):
        st = parse_latex_statement(r'f(x)=x^2', ParseContext(values={'x': sp.Integer(3)}))
        self.assertEqual(st.expr, x ** 2)

    def test_assignments(self):
        for src, name in [('k=4.5', 'k'), ('v_0 = 3', 'v_0'), ('mass = 5', 'mass'), (r'\alpha=2', 'alpha')]:
            st = parse_latex_statement(src)
            self.assertEqual((st.kind, st.name), ('assign', name), src)

    def test_equations_are_not_assignments(self):
        self.assertEqual(parse_latex_statement('x^2=4').kind, 'expr')
        self.assertEqual(parse_latex_statement('2x=4').kind, 'expr')


class TestErrors(unittest.TestCase):
    def test_clear_errors(self):
        for src in [r'\placeholder{}+1', r'\frac{1}{', r'x+', r'\int_0 x dx', r'\sum_{n}^{5} n', r'1 \pm 2']:
            with self.assertRaises(LatexParseError, msg=src):
                parse(src)


class TestCodeGeneration(unittest.TestCase):
    def roundtrip(self, src):
        expr = parse(src)
        decl, renames = symbol_declarations([expr])
        ns = {'sp': sp}
        exec('\n'.join(decl + ['__r = ' + to_code(expr, renames)]), ns)
        return expr, ns['__r']

    def test_code_is_runnable_and_equivalent(self):
        for src in [r'\frac{PL^3}{3EI}', r'\lambda x^{1/3}+e^{x}', r'\int_0^1 x^2\,dx', r'\frac{d}{dx}\sin x',
                    r'\sum_{n=1}^{\infty}\frac{1}{n^2}', r'\lim_{x\to0}\frac{\sin x}{x}', r'\frac{1}{3}x+i',
                    r'\begin{pmatrix}1&x\\0&1\end{pmatrix}', r'E^{2}+e']:
            expr, back = self.roundtrip(src)
            self.assertEqual(sp.simplify(sp.sympify(back).doit() - sp.sympify(expr).doit()) if not
                             isinstance(expr, sp.MatrixBase) else back - expr, 0 if not isinstance(expr, sp.MatrixBase)
                             else sp.zeros(*expr.shape), src)

    def test_shadowing_names_are_renamed(self):
        code = to_code(parse(r'EI'))
        self.assertNotIn('sp.E', code)
        self.assertIn('E_', code)


if __name__ == '__main__':
    unittest.main()
