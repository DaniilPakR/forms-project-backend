const errorHandler = (err, req, res, next) => {
  console.error("Error details:", {
    message: err.message,
    stack: err.stack,
    status: err.status || 500,
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    query: req.query,
    params: req.params,
  });

  res.status(err.status || 500).json({
    success: false,
    message: err.message || "An unexpected error occurred.",
  });
};

module.exports = errorHandler;
