"""End-to-end tests: JSON payload in, JSON result out, exactly as the browser calls the kernel."""

import os
import sys
import unittest

import sympy as sp

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from harness import Kernel  # noqa: E402

x, y, L, P, E, I = sp.symbols('x y L P E I')


class TestCells(unittest.TestCase):
    def setUp(self):
        self.k = Kernel()

    def test_cantilever_deflection_is_real(self):
        self.assertEqual(self.k.value(r'\frac{PL^3}{3EI}'), L ** 3 * P / (3 * E * I))

    def test_parsed_echo_and_warnings_are_returned(self):
        res = self.k.run(r'mass\cdot a')
        self.assertEqual(res['status'], 'ok')
        self.assertTrue(res['parsedLatex'])
        self.assertTrue(res['warnings'])

    def test_assignment_and_reuse(self):
        self.k.run('k=4.5')
        self.assertEqual(self.k.value('kx^2'), 4.5 * x ** 2)

    def test_output_recall_after_assignment(self):
        self.k.run('k=2')
        self.assertEqual(self.k.value('%1+1'), 3)
        self.assertEqual(self.k.value('%+1'), 4)

    def test_function_definition_and_derivative(self):
        self.k.run(r'f(x)=x^2\sin(x)')
        self.assertEqual(self.k.value(r'f(\pi)'), 0)
        self.assertEqual(self.k.value(r"f'(x)"), sp.diff(x ** 2 * sp.sin(x), x))

    def test_operations(self):
        self.assertEqual(self.k.value('x^2-4=0', 'solve', {'var': 'x'}), [-2, 2])
        self.assertEqual(self.k.value(r'\sin(x)', 'integrate_def', {'var': 'x', 'lower': '0', 'upper': r'\pi'}), 2)
        self.assertEqual(self.k.value(r'\frac{\sin x}{x}', 'limit', {'var': 'x', 'point': '0'}), 1)
        self.assertEqual(self.k.value('1/x', 'limit', {'var': 'x', 'point': 'oo'}), 0)
        self.assertEqual(self.k.value('x^3', 'diff', {'var': 'x', 'order': '2'}), 6 * x)
        self.assertEqual(self.k.value('x+y=3', 'solve_system', {'eq2': 'x-y=1', 'vars': 'x, y'}), [{x: 2, y: 1}])
        self.assertEqual(self.k.value(r'\begin{bmatrix}1&2\\3&4\end{bmatrix}', 'mat_det'), -2)

    def test_typed_integral_with_integrate_operation(self):
        self.assertEqual(self.k.value(r'\int_0^1 x\,dx', 'integrate_def', {'var': 'x', 'lower': '0', 'upper': '1'}),
                         sp.Rational(1, 2))

    def test_ode_with_initial_conditions(self):
        res = self.k.value(r"y''+y=0", 'ode_solve', {'func': 'y(x)', 'ic1': 'y(0)=1', 'ic2': "y'(0)=0"})
        self.assertEqual(res, sp.Eq(sp.Function('y')(x), sp.cos(x)))

    def test_ode_leibniz_form(self):
        res = self.k.value(r'\frac{dy}{dx}=y', 'ode_solve', {'func': 'y(x)', 'ic1': 'y(0)=2'})
        self.assertEqual(res, sp.Eq(sp.Function('y')(x), 2 * sp.exp(x)))

    def test_assumptions_reach_the_operation_variable(self):
        self.k.ns['apply_symbol_assumptions']('{"symbols": "x", "positive": true}')
        res = self.k.value(r'\sqrt{x^2}', 'diff', {'var': 'x'})
        self.assertEqual(res, 1)

    def test_hooke_uses_youngs_modulus_symbol(self):
        out = self.k.value(r'\begin{bmatrix}\epsilon & 0\\0&\epsilon\end{bmatrix}', 'mech_hooke',
                           {'state': 'plane_stress', 'direction': 'strain_to_stress', 'E': 'E', 'nu': 'nu'})
        self.assertIn(E, out.free_symbols)
        self.assertNotIn(sp.E, out.atoms(sp.NumberSymbol))

    def test_mohr_accepts_stress_vector(self):
        out = self.k.value('[-120, 0, 45]', 'mech_mohr')
        self.assertEqual(out, sp.Matrix([-60 + 75, -60 - 75, 75]))

    def test_parse_errors_are_reported(self):
        res = self.k.run(r'\frac{1}{')
        self.assertEqual(res['status'], 'error')
        self.assertIn('Could not read', res['message'])

    def test_code_cells_keep_sympy_semantics(self):
        res = self.k.run('', mode='code', code='E**(I*pi)')
        self.assertEqual(res['status'], 'ok')
        self.assertEqual(self.k.ns['out_history'][self.k.n], -1)


class TestVisualToCode(unittest.TestCase):
    def setUp(self):
        self.k = Kernel()

    def run_generated(self, code):
        res = self.k.run('', mode='code', code=code)
        self.assertEqual(res['status'], 'ok', res.get('message'))
        return self.k.ns['out_history'][self.k.n]

    def test_generated_code_reproduces_the_visual_result(self):
        cases = [
            (r'\frac{PL^3}{3EI}', 'eval', {}),
            (r'\frac{PL^3}{3EI}', 'diff', {'var': 'L', 'order': '1'}),
            (r'\int_0^1 \lambda x^{2}\,dx', 'eval', {}),
            (r'x^2-4=0', 'solve', {'var': 'x'}),
            (r'e^{x}', 'series', {'var': 'x', 'point': '0', 'order': '4'}),
            (r'x^2+y^2', 'curv_grad', {'system': 'cartesian', 'coords': 'x, y, z'}),
        ]
        for latex, op, params in cases:
            visual = self.k.value(latex, op, params)
            conv = self.k.code(latex, op, params)
            self.assertEqual(conv['status'], 'ok', latex)
            generated = self.run_generated(conv['code'])
            if isinstance(visual, sp.MatrixBase):
                self.assertEqual(sp.simplify(generated - visual), sp.zeros(*visual.shape), latex)
            elif isinstance(visual, list):
                self.assertEqual(generated, visual, latex)
            else:
                diff = sp.sympify(generated) - visual
                self.assertEqual(sp.simplify(diff.removeO() if diff.has(sp.Order) else diff), 0, f"{latex}\n{conv['code']}")


if __name__ == '__main__':
    unittest.main()
