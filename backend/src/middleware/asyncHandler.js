// Wraps an async Express handler so a rejected promise reaches next(err)
// instead of being an unhandled rejection Express never learns about —
// without this, a thrown error in any async controller just hangs the request.
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
