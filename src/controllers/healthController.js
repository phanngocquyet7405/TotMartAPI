const mongoose = require('mongoose');
const redis = require('../config/redis');
let stopping = false;
async function readiness(req, res) {
  res.set('Cache-Control', 'no-store');
  if (stopping || mongoose.connection.readyState !== 1 || !redis.ready()) return res.status(503).json({ success: false, status: 'not_ready' });
  try {
    await mongoose.connection.db.command({ ping: 1 }, { timeoutMS: 2000 });
    res.json({ success: true, status: 'ready' });
  } catch { res.status(503).json({ success: false, status: 'not_ready' }); }
}
module.exports = { readiness, liveness: (req,res) => res.json({success:true,status:'alive'}), setStopping: value => { stopping = value; } };
