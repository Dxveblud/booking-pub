/**
 * Gestione dei servizi offerti (CRUD admin + elenco pubblico).
 */
const mongoose = require('mongoose');
const { Service } = require('../models');
const { badRequest, notFound } = require('../utils/errors');

function serializeService(s) {
  return {
    id: String(s._id),
    name: s.name,
    description: s.description || '',
    category: s.category || '',
    durationMinutes: s.durationMinutes,
    price: s.priceCents / 100,
    active: s.active,
    sortOrder: s.sortOrder,
  };
}

/** Converte il body della richiesta nei campi del modello. */
function parseServiceInput(body, { partial = false } = {}) {
  const data = {};
  if (body.name !== undefined || !partial) {
    const name = String(body.name || '').trim();
    if (!name) throw badRequest('Il nome del servizio è obbligatorio');
    data.name = name;
  }
  if (body.description !== undefined) data.description = String(body.description || '').trim();
  if (body.category !== undefined) {
    const category = String(body.category || '').trim().replace(/\s+/g, ' ');
    if (category.length > 40) throw badRequest('La categoria può avere al massimo 40 caratteri');
    data.category = category;
  }
  if (body.durationMinutes !== undefined || !partial) {
    const d = Number(body.durationMinutes);
    if (!Number.isInteger(d) || d <= 0) throw badRequest('Durata non valida');
    data.durationMinutes = d;
  }
  if (body.price !== undefined || !partial) {
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0) throw badRequest('Prezzo non valido');
    data.priceCents = Math.round(p * 100);
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  if (body.sortOrder !== undefined) data.sortOrder = Number(body.sortOrder) || 0;
  return data;
}

function listServices(businessId, { onlyActive = false } = {}) {
  const query = { businessId };
  if (onlyActive) query.active = true;
  return Service.find(query).sort({ sortOrder: 1, name: 1 });
}

async function createService(businessId, body) {
  return Service.create({ businessId, ...parseServiceInput(body) });
}

async function updateService(businessId, id, body) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Servizio non trovato');
  const service = await Service.findOne({ _id: id, businessId });
  if (!service) throw notFound('Servizio non trovato');
  Object.assign(service, parseServiceInput(body, { partial: true }));
  await service.save();
  return service;
}

/**
 * Elimina un servizio. Le prenotazioni esistenti non vengono toccate perché
 * contengono già una copia di nome, durata e prezzo.
 */
async function deleteService(businessId, id) {
  if (!mongoose.isValidObjectId(id)) throw notFound('Servizio non trovato');
  const res = await Service.deleteOne({ _id: id, businessId });
  if (!res.deletedCount) throw notFound('Servizio non trovato');
}

module.exports = { listServices, createService, updateService, deleteService, serializeService };
