// Printable QR codes for the doors (docs/journey-map.md: "I'm at the door", "I'm in the room", staff QR per door).
// People scan them with the phone camera, so all we need is the image; the URL inside is the screen's address.
const express = require('express');
const QRCode = require('qrcode');

const PATHS = { door: (id) => `/r/${id}`, in: (id) => `/r/${id}/in`, staff: (id) => `/staff/room/${id}` };

function qrRouter({ store, requireRole }) {
  const r = express.Router();
  r.get('/qr/:file', async (req, res, next) => {
    const id = req.params.file.replace(/\.svg$/, '');
    const kind = req.query.kind || 'door';
    const sp = store.db.spaces.get(id);
    if (!req.params.file.endsWith('.svg') || !sp || sp.test) return res.status(404).json({ error: 'No such space.' });
    if (!PATHS[kind] || (sp.type === 'venue' && kind === 'in')) return res.status(400).json({ error: 'kind must be door, in or staff (the venue has no "in" code).' });
    const send = async () => {
      // PUBLIC_URL makes printed codes point at the deployed site; locally it falls back to the address you opened.
      const base = (process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
      const svg = await QRCode.toString(base + PATHS[kind](sp.id), { type: 'svg', margin: 2, errorCorrectionLevel: 'M' });
      res.type('image/svg+xml').set('cache-control', 'no-store').send(svg);
    };
    // Staff codes lead to a page that still needs a staff login, but we don't hand them out publicly either.
    if (kind === 'staff') return requireRole('staff')(req, res, () => send().catch(next));
    send().catch(next);
  });
  return r;
}

module.exports = { qrRouter, PATHS };
