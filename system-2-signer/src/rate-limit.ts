export class SlidingWindowCounter {
  private count = 0;
  private resetAt = Date.now();

  constructor(private readonly windowMs: number) {}

  hit(now = Date.now()): number {
    if (now > this.resetAt) {
      this.count = 0;
      this.resetAt = now + this.windowMs;
    }
    this.count += 1;
    return this.count;
  }
}

