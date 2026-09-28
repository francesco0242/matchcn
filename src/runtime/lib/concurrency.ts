// Minimal concurrency limiter, no dependency needed for this small a use.
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    active--;
    if (queue.length > 0) {
      const run = queue.shift()!;
      run();
    }
  };

  return function limit<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const run = () => {
        active++;
        // Promise.resolve().then(fn), not a bare fn(): every current
        // caller passes an async function (which per spec can't throw
        // synchronously), but this is a shared, generic utility with no
        // such contract enforced. A bare `fn()` that threw synchronously
        // would skip the .catch below entirely, never calling next() and
        // permanently leaking one unit of concurrency.
        Promise.resolve()
          .then(fn)
          .then((result) => {
            next();
            resolve(result);
          })
          .catch((err) => {
            next();
            reject(err);
          });
      };
      if (active < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
