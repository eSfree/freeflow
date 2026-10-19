const path = require('path');
const express = require('express');
const { migrate, dbPath } = require('./db/connection');
const { router: authRouter, sessionMiddleware } = require('./auth/auth');

migrate();

const app = express();
app.use(express.json());
app.use(sessionMiddleware());

app.use('/api/auth', authRouter);
app.use('/api', require('./routes/projects'));
app.use('/api', require('./routes/calendars'));
app.use('/api', require('./routes/tasks'));
app.use('/api', require('./routes/members'));
app.use('/api', require('./routes/reports'));

// Static frontend
const publicDir = path.join(__dirname, '..', 'public');
app.use(express.static(publicDir));
app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(publicDir, 'index.html')));

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`ProjectFlow running on http://localhost:${PORT}\nDB: ${dbPath}`));
}
module.exports = app;
