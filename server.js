require('dotenv').config();
const express = require('express');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = process.env.DB_NAME || 'game_collection_db';
const COLLECTION_NAME = 'games';

let gamesCollection;
let client;

async function startDb() {
  client = new MongoClient(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
  await client.connect();
  const db = client.db(DB_NAME);
  gamesCollection = db.collection(COLLECTION_NAME);
  console.log('MongoDB connecté');
}

const gameSchema = {
  titre: { type: 'string', required: true, minLength: 1 },
  genre: { type: 'array', required: true, minItems: 1 },
  plateforme: { type: 'array', required: true, minItems: 1 },
  editeur: { type: 'string', required: false },
  developpeur: { type: 'string', required: false },
  annee_sortie: { type: 'number', required: false, min: 1970, max: new Date().getFullYear() },
  temps_jeu_heures: { type: 'number', required: false, min: 0 },
  termine: { type: 'boolean', required: false },
};

function validateGame(payload, { isUpdate = false } = {}) {
  const errors = [];
  Object.keys(gameSchema).forEach(key => {
    const s = gameSchema[key];
    const v = payload[key];
    if (!isUpdate && s.required && (v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0))) {
      errors.push(`${key} requis`);
      return;
    }
    if (v !== undefined && v !== null) {
      if (s.type === 'string' && typeof v !== 'string') errors.push(`${key} doit être une chaîne`);
      if (s.type === 'array' && !Array.isArray(v)) errors.push(`${key} doit être un tableau`);
      if (s.type === 'number' && typeof v !== 'number') errors.push(`${key} doit être un nombre`);
      if (s.type === 'boolean' && typeof v !== 'boolean') errors.push(`${key} doit être boolean`);
      if (s.min !== undefined && typeof v === 'number' && v < s.min) errors.push(`${key} doit être >= ${s.min}`);
      if (s.max !== undefined && typeof v === 'number' && v > s.max) errors.push(`${key} doit être <= ${s.max}`);
      if (s.minItems !== undefined && Array.isArray(v) && v.length < s.minItems) errors.push(`${key} doit contenir au moins ${s.minItems} élément(s)`);
      if (s.minLength !== undefined && typeof v === 'string' && v.length < s.minLength) errors.push(`${key} trop court`);
    }
  });
  return errors;
}

function toResp(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id.toString(), ...rest };
}

/* POST /api/games */
app.post('/api/games', async (req, res) => {
  try {
    const payload = req.body;
    const errors = validateGame(payload, { isUpdate: false });
    if (errors.length) return res.status(400).json({ errors });

    const now = new Date();
    const doc = {
      titre: payload.titre,
      genre: payload.genre,
      plateforme: payload.plateforme,
      editeur: payload.editeur || null,
      developpeur: payload.developpeur || null,
      annee_sortie: payload.annee_sortie ?? null,
      temps_jeu_heures: payload.temps_jeu_heures ?? 0,
      termine: !!payload.termine,
      favorite: !!payload.favorite,
      date_ajout: now,
      date_modification: now,
    };
    const r = await gamesCollection.insertOne(doc);
    const inserted = await gamesCollection.findOne({ _id: r.insertedId });
    res.status(201).json(toResp(inserted));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

/* GET /api/games (liste + filtres) */
app.get('/api/games', async (req, res) => {
  try {
    const { genre, plateforme, termine, favorite } = req.query;
    const filter = {};
    if (genre) filter.genre = genre;
    if (plateforme) filter.plateforme = plateforme;
    if (termine === 'true') filter.termine = true;
    if (termine === 'false') filter.termine = false;
    if (favorite === 'true') filter.favorite = true;
    if (favorite === 'false') filter.favorite = false;

    const docs = await gamesCollection.find(filter).sort({ date_ajout: -1 }).toArray();
    res.json(docs.map(toResp));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

/* GET /api/games/:id */
app.get('/api/games/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'id invalide' });
    const doc = await gamesCollection.findOne({ _id: new ObjectId(id) });
    if (!doc) return res.status(404).json({ error: 'non trouvé' });
    res.json(toResp(doc));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.put('/api/games/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'id invalide' });
    const payload = req.body;
    const errors = validateGame(payload, { isUpdate: true });
    if (errors.length) return res.status(400).json({ errors });

    const allowed = ['titre','genre','plateforme','editeur','developpeur','annee_sortie','temps_jeu_heures','termine','favorite'];
    const set = {};
    allowed.forEach(k => { if (payload[k] !== undefined) set[k] = payload[k]; });
    if (Object.keys(set).length === 0) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });
    set.date_modification = new Date();

    const r = await gamesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: set },
      { returnDocument: 'after' }
    );
    if (!r.value) return res.status(404).json({ error: 'non trouvé' });
    res.json(toResp(r.value));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.delete('/api/games/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'id invalide' });
    const r = await gamesCollection.deleteOne({ _id: new ObjectId(id) });
    if (r.deletedCount === 0) return res.status(404).json({ error: 'non trouvé' });
    res.status(204).send();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.post('/api/games/:id/favorite', async (req, res) => {
  try {
    const id = req.params.id;
    if (!ObjectId.isValid(id)) return res.status(400).json({ error: 'id invalide' });
    const g = await gamesCollection.findOne({ _id: new ObjectId(id) });
    if (!g) return res.status(404).json({ error: 'non trouvé' });
    const r = await gamesCollection.findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $set: { favorite: !g.favorite, date_modification: new Date() } },
      { returnDocument: 'after' }
    );
    res.json(toResp(r.value));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    const docs = await gamesCollection.find({}).toArray();
    const total = docs.length;
    const totalHours = docs.reduce((s, d) => s + (d.temps_jeu_heures || 0), 0);
    const finished = docs.filter(d => d.termine).length;
    const favs = docs.filter(d => d.favorite).length;
    res.json({ totalGames: total, totalPlayTime: totalHours, finishedGames: finished, favoriteGames: favs });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.get('/api/games/export', async (req, res) => {
  try {
    const docs = await gamesCollection.find({}).toArray();
    res.setHeader('Content-Disposition', 'attachment; filename=games.json');
    res.json(docs.map(toResp));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'erreur serveur' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

startDb()
  .then(() => app.listen(PORT, () => console.log(`Serveur: http://localhost:${PORT}`)))
  .catch(err => { console.error('DB Connexion échouée', err); process.exit(1); });
