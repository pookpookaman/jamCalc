/**
 * Exact rational arithmetic.
 *
 * Exists solely to hold unit dimension exponents. Those must be exact:
 * `sqrt(f'c)` in ACI produces force^(1/2)/length, and a floating-point
 * exponent would make `x^(1/3)` cubed fail to compare equal to `x`.
 *
 * Always normalized: gcd-reduced, denominator > 0, zero is 0/1.
 */

function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b !== 0) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export class Rational {
  readonly num: number;
  readonly den: number;

  private constructor(num: number, den: number) {
    this.num = num;
    this.den = den;
  }

  static of(num: number, den = 1): Rational {
    if (den === 0) throw new RangeError("Rational denominator must be non-zero");
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      throw new RangeError(`Rational requires integers, got ${num}/${den}`);
    }
    if (num === 0) return Rational.ZERO;
    let n = num;
    let d = den;
    if (d < 0) {
      n = -n;
      d = -d;
    }
    const g = gcd(n, d);
    return new Rational(n / g, d / g);
  }

  static readonly ZERO = new Rational(0, 1);
  static readonly ONE = new Rational(1, 1);
  static readonly HALF = new Rational(1, 2);

  add(o: Rational): Rational {
    return Rational.of(this.num * o.den + o.num * this.den, this.den * o.den);
  }

  sub(o: Rational): Rational {
    return Rational.of(this.num * o.den - o.num * this.den, this.den * o.den);
  }

  mul(o: Rational): Rational {
    return Rational.of(this.num * o.num, this.den * o.den);
  }

  div(o: Rational): Rational {
    if (o.num === 0) throw new RangeError("Rational division by zero");
    return Rational.of(this.num * o.den, this.den * o.num);
  }

  neg(): Rational {
    return Rational.of(-this.num, this.den);
  }

  get isZero(): boolean {
    return this.num === 0;
  }

  get isInteger(): boolean {
    return this.den === 1;
  }

  equals(o: Rational): boolean {
    // Both sides are normalized, so structural equality is value equality.
    return this.num === o.num && this.den === o.den;
  }

  toNumber(): number {
    return this.num / this.den;
  }

  toString(): string {
    return this.den === 1 ? String(this.num) : `${this.num}/${this.den}`;
  }
}
