import { delay, getDB, updateDB } from '@/lib/db';
import type {
  Asset,
  AuditLog,
  Booking,
  CalendarEvent,
  Device,
  Incident,
  Journal,
  Laboratory,
  Loan,
  MaintenanceExecution,
  MaintenancePlan,
  MaintenanceFrequency,
  MasterDataCategoryKey,
  MasterDataItem,
  Notification,
  Schedule,
  Session,
  StockItem,
  StockTransaction,
  User,
  WorkOrder,
  WorkOrderSparePart,
} from '@/types';
import { can, type PermissionMatrix } from '@/lib/permissions';
import { MASTER_DATA_CATEGORY_KEYS } from '@/lib/masterData';
import { uid } from '@/utils';

/**
 * Generic repository abstraction.
 * Today: backed by localStorage. Tomorrow: swap impl for Laravel REST API.
 */
export interface Repository<T, CreateInput = Partial<T>, UpdateInput = Partial<T>> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  create(input: CreateInput): Promise<T>;
  update(id: string, input: UpdateInput): Promise<T>;
  remove(id: string): Promise<void>;
}

function logAudit(entry: Omit<AuditLog, 'id' | 'at'>): void {
  updateDB((db) => {
    db.auditLogs.unshift({
      id: uid('al'),
      at: new Date().toISOString(),
      ...entry,
    });
    if (db.auditLogs.length > 500) db.auditLogs = db.auditLogs.slice(0, 500);
  });
}

export const auditLog = {
  log: logAudit,
  async getAll(): Promise<AuditLog[]> {
    await delay(100);
    return getDB().auditLogs;
  },
};

// Laboratories
export const laboratoryRepository: Repository<Laboratory> = {
  async getAll() {
    await delay();
    return getDB().labs;
  },
  async getById(id) {
    await delay();
    return getDB().labs.find((l) => l.id === id) ?? null;
  },
  async create(input) {
    await delay();
    const item: Laboratory = {
      id: uid('lab'),
      name: input.name ?? 'New Lab',
      code: input.code ?? 'LAB',
      location: input.location ?? '',
      capacity: input.capacity ?? 36,
      headName: input.headName ?? '',
      technicianName: input.technicianName ?? '',
      pcCount: input.pcCount ?? 0,
      status: input.status ?? 'active',
      layoutRows: input.layoutRows ?? 6,
      layoutCols: input.layoutCols ?? 6,
    };
    updateDB((db) => db.labs.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'laboratories', action: 'create', object: item.id, newValue: item.name, device: 'Web' });
    return item;
  },
  async update(id, input) {
    await delay();
    let updated: Laboratory | null = null;
    updateDB((db) => {
      const idx = db.labs.findIndex((l) => l.id === id);
      if (idx >= 0) {
        db.labs[idx] = { ...db.labs[idx], ...input };
        updated = db.labs[idx];
      }
    });
    if (updated) logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'laboratories', action: 'update', object: id, newValue: JSON.stringify(input), device: 'Web' });
    return updated!;
  },
  async remove(id) {
    await delay();
    updateDB((db) => {
      db.labs = db.labs.filter((l) => l.id !== id);
      db.devices = db.devices.filter((d) => d.laboratoryId !== id);
    });
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'laboratories', action: 'delete', object: id, device: 'Web' });
  },
};

// Devices
export const deviceRepository = {
  async getAll(): Promise<Device[]> {
    await delay();
    return getDB().devices;
  },
  async getByLab(labId: string): Promise<Device[]> {
    await delay();
    return getDB().devices.filter((d) => d.laboratoryId === labId);
  },
  async getById(id: string): Promise<Device | null> {
    await delay();
    return getDB().devices.find((d) => d.id === id) ?? null;
  },
  async update(id: string, input: Partial<Device>): Promise<Device | null> {
    await delay();
    let updated: Device | null = null;
    updateDB((db) => {
      const idx = db.devices.findIndex((d) => d.id === id);
      if (idx >= 0) {
        db.devices[idx] = { ...db.devices[idx], ...input, lastHeartbeat: input.status ? new Date().toISOString() : db.devices[idx].lastHeartbeat };
        updated = db.devices[idx];
      }
    });
    return updated;
  },
  async simulateHeartbeat(labId?: string): Promise<Device[]> {
    await delay(400);
    updateDB((db) => {
      db.devices.forEach((d) => {
        if (labId && d.laboratoryId !== labId) return;
        if (d.status === 'Online') {
          d.cpuUsage = Math.min(95, Math.max(5, d.cpuUsage + (Math.random() * 20 - 10)));
          d.ramUsage = Math.min(95, Math.max(15, d.ramUsage + (Math.random() * 15 - 7)));
          d.lastHeartbeat = new Date().toISOString();
        }
      });
    });
    return labId ? getDB().devices.filter((d) => d.laboratoryId === labId) : getDB().devices;
  },
  async updateLayoutPositions(labId: string, positions: { id: string; col: number; row: number }[]): Promise<void> {
    await delay();
    updateDB((db) => {
      positions.forEach((p) => {
        const idx = db.devices.findIndex((d) => d.id === p.id);
        if (idx >= 0) {
          db.devices[idx].col = p.col;
          db.devices[idx].row = p.row;
        }
      });
    });
  },
};

// Assets
export const assetRepository: Repository<Asset> & {
  transfer(id: string, transfer: { toLabId: string; toPosition: string; reason: string; by: string }): Promise<Asset | null>;
} = {
  async getAll() {
    await delay();
    return getDB().assets;
  },
  async getById(id) {
    await delay();
    return getDB().assets.find((a) => a.id === id) ?? null;
  },
  async create(input) {
    await delay();
    const item: Asset = {
      id: uid('ast'),
      assetCode: input.assetCode ?? `AST-${uid().slice(0, 6).toUpperCase()}`,
      name: input.name ?? '',
      category: input.category ?? '',
      model: input.model ?? '',
      brand: input.brand ?? '',
      serialNumber: input.serialNumber ?? '',
      laboratoryId: input.laboratoryId ?? '',
      position: input.position ?? '',
      yearAcquired: input.yearAcquired ?? new Date().getFullYear(),
      fundingSource: input.fundingSource ?? 'BOS',
      price: input.price ?? 0,
      condition: input.condition ?? 'Baik',
      status: input.status ?? 'Aktif',
      purchaseDate: input.purchaseDate ?? new Date().toISOString().split('T')[0],
      warrantyUntil: input.warrantyUntil ?? '',
      supplier: input.supplier ?? '',
      notes: input.notes,
    };
    updateDB((db) => db.assets.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'assets', action: 'create', object: item.assetCode, newValue: item.name, device: 'Web' });
    return item;
  },
  async update(id, input) {
    await delay();
    let updated: Asset | null = null;
    updateDB((db) => {
      const idx = db.assets.findIndex((a) => a.id === id);
      if (idx >= 0) {
        db.assets[idx] = { ...db.assets[idx], ...input };
        updated = db.assets[idx];
      }
    });
    if (updated) logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'assets', action: 'update', object: id, newValue: JSON.stringify(input), device: 'Web' });
    return updated!;
  },
  async remove(id) {
    await delay();
    updateDB((db) => {
      db.assets = db.assets.filter((a) => a.id !== id);
    });
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'assets', action: 'delete', object: id, device: 'Web' });
  },
  async transfer(id: string, transfer: { toLabId: string; toPosition: string; reason: string; by: string }): Promise<Asset | null> {
    await delay();
    let updated: Asset | null = null;
    updateDB((db) => {
      const idx = db.assets.findIndex((a) => a.id === id);
      if (idx >= 0) {
        const old = `${db.assets[idx].laboratoryId}/${db.assets[idx].position}`;
        db.assets[idx].laboratoryId = transfer.toLabId;
        db.assets[idx].position = transfer.toPosition;
        updated = db.assets[idx];
        db.auditLogs.unshift({
          id: uid('al'),
          at: new Date().toISOString(),
          userName: transfer.by,
          role: 'Admin Lab',
          module: 'assets',
          action: 'transfer',
          object: id,
          oldValue: old,
          newValue: `${transfer.toLabId}/${transfer.toPosition}`,
          device: 'Web',
        });
      }
    });
    return updated;
  },
};

// Schedules
export const scheduleRepository: Repository<Schedule> = {
  async getAll() {
    await delay();
    return getDB().schedules;
  },
  async getById(id) {
    await delay();
    return getDB().schedules.find((s) => s.id === id) ?? null;
  },
  async create(input) {
    await delay();
    const item: Schedule = {
      id: uid('sch'),
      day: input.day ?? 'Senin',
      date: input.date ?? new Date().toISOString().split('T')[0],
      startTime: input.startTime ?? '07:00',
      endTime: input.endTime ?? '09:30',
      lessonHours: input.lessonHours ?? 3,
      laboratoryId: input.laboratoryId ?? '',
      className: input.className ?? '',
      teacherName: input.teacherName ?? '',
      subject: input.subject ?? '',
      activityType: input.activityType ?? 'Praktikum',
      status: input.status ?? 'Tetap',
      semester: input.semester ?? 'Gasal',
    };
    updateDB((db) => db.schedules.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'schedules', action: 'create', object: item.id, device: 'Web' });
    return item;
  },
  async update(id, input) {
    await delay();
    let updated: Schedule | null = null;
    updateDB((db) => {
      const idx = db.schedules.findIndex((s) => s.id === id);
      if (idx >= 0) {
        db.schedules[idx] = { ...db.schedules[idx], ...input };
        updated = db.schedules[idx];
      }
    });
    return updated!;
  },
  async remove(id) {
    await delay();
    updateDB((db) => {
      db.schedules = db.schedules.filter((s) => s.id !== id);
    });
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'schedules', action: 'delete', object: id, device: 'Web' });
  },
};

// Bookings
export const bookingRepository = {
  async getAll(): Promise<Booking[]> {
    await delay();
    return getDB().bookings;
  },
  async getById(id: string): Promise<Booking | null> {
    await delay();
    return getDB().bookings.find((b) => b.id === id) ?? null;
  },
  async create(input: Partial<Booking>): Promise<Booking> {
    await delay();
    const item: Booking = {
      id: uid('bkg'),
      requesterName: input.requesterName ?? '',
      laboratoryId: input.laboratoryId ?? '',
      date: input.date ?? '',
      startTime: input.startTime ?? '',
      endTime: input.endTime ?? '',
      activity: input.activity ?? '',
      participants: input.participants ?? 0,
      deviceNeeds: input.deviceNeeds ?? '',
      notes: input.notes,
      PIC: input.PIC ?? '',
      status: input.status ?? 'Diajukan',
      timeline: [{ status: 'Diajukan', at: new Date().toISOString(), by: input.requesterName ?? 'User' }],
    };
    updateDB((db) => db.bookings.push(item));
    logAudit({ userName: 'Admin', role: 'Guru', module: 'bookings', action: 'create', object: item.id, device: 'Web' });
    return item;
  },
  async updateStatus(id: string, status: Booking['status'], by: string, reason?: string): Promise<Booking | null> {
    await delay();
    let updated: Booking | null = null;
    updateDB((db) => {
      const idx = db.bookings.findIndex((b) => b.id === id);
      if (idx >= 0) {
        db.bookings[idx].status = status;
        if (reason) db.bookings[idx].rejectionReason = reason;
        db.bookings[idx].timeline.push({ status, at: new Date().toISOString(), by });
        updated = db.bookings[idx];
      }
    });
    return updated;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.bookings = db.bookings.filter((b) => b.id !== id);
    });
  },
};

// Sessions
export const sessionRepository = {
  async getAll(): Promise<Session[]> {
    await delay();
    return getDB().sessions;
  },
  async getById(id: string): Promise<Session | null> {
    await delay();
    return getDB().sessions.find((s) => s.id === id) ?? null;
  },
  async create(input: Partial<Session>): Promise<Session> {
    await delay();
    const item: Session = {
      id: uid('ses'),
      laboratoryId: input.laboratoryId ?? '',
      scheduleId: input.scheduleId,
      teacherName: input.teacherName ?? '',
      className: input.className ?? '',
      subject: input.subject ?? '',
      participantCount: input.participantCount ?? 0,
      startTime: input.startTime ?? new Date().toISOString(),
      initialCondition: input.initialCondition ?? '',
      brokenPCsBefore: input.brokenPCsBefore ?? [],
      notes: input.notes ?? '',
      status: 'Belum Dimulai',
    };
    updateDB((db) => db.sessions.push(item));
    logAudit({ userName: 'Admin', role: 'Guru', module: 'sessions', action: 'create', object: item.id, device: 'Web' });
    return item;
  },
  async update(id: string, input: Partial<Session>): Promise<Session | null> {
    await delay();
    let updated: Session | null = null;
    updateDB((db) => {
      const idx = db.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        db.sessions[idx] = { ...db.sessions[idx], ...input };
        updated = db.sessions[idx];
      }
    });
    return updated;
  },
  async startSession(id: string): Promise<Session | null> {
    return sessionRepository.update(id, { status: 'Berlangsung', startTime: new Date().toISOString() });
  },
  async finishSession(id: string, finalData: Partial<Session>): Promise<Session | null> {
    await delay();
    let updated: Session | null = null;
    let newJournal: Journal | null = null;
    updateDB((db) => {
      const idx = db.sessions.findIndex((s) => s.id === id);
      if (idx >= 0) {
        const session = db.sessions[idx];
        db.sessions[idx] = {
          ...session,
          ...finalData,
          status: 'Selesai',
          endTime: new Date().toISOString(),
        };
        updated = db.sessions[idx];
        // Auto-create journal
        const jn = `JRN-2026-${String(db.journals.length + 1).padStart(4, '0')}`;
        newJournal = {
          id: uid('jrn'),
          journalNumber: jn,
          date: new Date().toISOString().split('T')[0],
          laboratoryId: session.laboratoryId,
          teacherName: session.teacherName,
          className: session.className,
          subject: session.subject,
          hours: 3,
          material: finalData.finalMaterial ?? '',
          software: finalData.finalSoftware ?? '',
          presentCount: finalData.presentCount ?? 0,
          absentCount: finalData.absentCount ?? 0,
          initialCondition: session.initialCondition,
          finalCondition: finalData.finalCondition ?? '',
          issues: finalData.issues ?? '',
          followUp: finalData.followUp ?? '',
          status: 'Draft',
          source: 'session',
          sessionId: session.id,
        };
        db.journals.unshift(newJournal);
        db.sessions[idx].journalId = newJournal.id;
      }
    });
    return updated;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.sessions = db.sessions.filter((s) => s.id !== id);
    });
  },
};

// Journals
export const journalRepository: Repository<Journal> = {
  async getAll() {
    await delay();
    return getDB().journals;
  },
  async getById(id) {
    await delay();
    return getDB().journals.find((j) => j.id === id) ?? null;
  },
  async create(input) {
    await delay();
    const num = `JRN-2026-${String(getDB().journals.length + 1).padStart(4, '0')}`;
    const item: Journal = {
      id: uid('jrn'),
      journalNumber: num,
      date: input.date ?? new Date().toISOString().split('T')[0],
      laboratoryId: input.laboratoryId ?? '',
      teacherName: input.teacherName ?? '',
      className: input.className ?? '',
      subject: input.subject ?? '',
      hours: input.hours ?? 3,
      material: input.material ?? '',
      software: input.software ?? '',
      presentCount: input.presentCount ?? 0,
      absentCount: input.absentCount ?? 0,
      initialCondition: input.initialCondition ?? '',
      finalCondition: input.finalCondition ?? '',
      issues: input.issues ?? '',
      followUp: input.followUp ?? '',
      status: input.status ?? 'Draft',
      source: input.source ?? 'manual',
      sessionId: input.sessionId,
    };
    updateDB((db) => db.journals.unshift(item));
    logAudit({ userName: 'Admin', role: 'Guru', module: 'journals', action: 'create', object: item.journalNumber, device: 'Web' });
    return item;
  },
  async update(id, input) {
    await delay();
    let updated: Journal | null = null;
    updateDB((db) => {
      const idx = db.journals.findIndex((j) => j.id === id);
      if (idx >= 0) {
        db.journals[idx] = { ...db.journals[idx], ...input };
        updated = db.journals[idx];
      }
    });
    return updated!;
  },
  async remove(id) {
    await delay();
    updateDB((db) => {
      db.journals = db.journals.filter((j) => j.id !== id);
    });
    logAudit({ userName: 'Admin', role: 'Guru', module: 'journals', action: 'delete', object: id, device: 'Web' });
  },
};

// Incidents
export const incidentRepository = {
  async getAll(): Promise<Incident[]> {
    await delay();
    return getDB().incidents;
  },
  async getById(id: string): Promise<Incident | null> {
    await delay();
    return getDB().incidents.find((i) => i.id === id) ?? null;
  },
  async create(input: Partial<Incident>): Promise<Incident> {
    await delay();
    const num = `INC-2026-${String(getDB().incidents.length + 1).padStart(4, '0')}`;
    const item: Incident = {
      id: uid('inc'),
      ticketNumber: num,
      reporterName: input.reporterName ?? '',
      laboratoryId: input.laboratoryId ?? '',
      assetCode: input.assetCode,
      date: input.date ?? new Date().toISOString(),
      category: input.category ?? 'lainnya',
      title: input.title ?? '',
      description: input.description ?? '',
      impact: input.impact ?? '',
      priority: input.priority ?? 'Normal',
      blocksPracticum: input.blocksPracticum ?? false,
      stepsTaken: input.stepsTaken ?? '',
      status: 'Dilaporkan',
      comments: [],
      timeline: [{ status: 'Dilaporkan', at: new Date().toISOString(), by: input.reporterName ?? 'User' }],
    };
    updateDB((db) => db.incidents.unshift(item));
    logAudit({ userName: 'Admin', role: 'Guru', module: 'incidents', action: 'create', object: item.ticketNumber, device: 'Web' });
    return item;
  },
  async update(id: string, input: Partial<Incident>): Promise<Incident | null> {
    await delay();
    let updated: Incident | null = null;
    updateDB((db) => {
      const idx = db.incidents.findIndex((i) => i.id === id);
      if (idx >= 0) {
        db.incidents[idx] = { ...db.incidents[idx], ...input };
        updated = db.incidents[idx];
      }
    });
    return updated;
  },
  async updateStatus(id: string, status: Incident['status'], by: string): Promise<Incident | null> {
    await delay();
    let updated: Incident | null = null;
    updateDB((db) => {
      const idx = db.incidents.findIndex((i) => i.id === id);
      if (idx >= 0) {
        db.incidents[idx].status = status;
        db.incidents[idx].timeline.push({ status, at: new Date().toISOString(), by });
        updated = db.incidents[idx];
      }
    });
    return updated;
  },
  async addComment(id: string, by: string, text: string): Promise<void> {
    await delay();
    updateDB((db) => {
      const idx = db.incidents.findIndex((i) => i.id === id);
      if (idx >= 0) {
        db.incidents[idx].comments.push({ at: new Date().toISOString(), by, text });
      }
    });
  },
  async convertToWorkOrder(id: string): Promise<WorkOrder | null> {
    await delay();
    let newWO: WorkOrder | null = null;
    updateDB((db) => {
      const inc = db.incidents.find((i) => i.id === id);
      if (!inc) return;
      const num = `WO-2026-${String(db.workOrders.length + 1).padStart(4, '0')}`;
      newWO = {
        id: uid('wo'),
        woNumber: num,
        incidentId: inc.id,
        assetCode: inc.assetCode,
        laboratoryId: inc.laboratoryId,
        technician: 'Andi Wijaya',
        priority: inc.priority,
        diagnosis: '',
        action: '',
        scheduledDate: new Date().toISOString().split('T')[0],
        spareParts: [],
        cost: 0,
        status: 'Draft',
        timeline: [{ status: 'Draft', at: new Date().toISOString(), by: 'Admin Lab' }],
      };
      db.workOrders.unshift(newWO);
      inc.workOrderId = newWO.id;
      inc.status = 'Ditugaskan';
      inc.timeline.push({ status: 'Ditugaskan', at: new Date().toISOString(), by: 'Admin Lab' });
    });
    return newWO;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.incidents = db.incidents.filter((i) => i.id !== id);
    });
  },
};

// Work Orders
export const workOrderRepository = {
  async getAll(): Promise<WorkOrder[]> {
    await delay();
    return getDB().workOrders;
  },
  async getById(id: string): Promise<WorkOrder | null> {
    await delay();
    return getDB().workOrders.find((w) => w.id === id) ?? null;
  },
  async create(input: Partial<WorkOrder>): Promise<WorkOrder> {
    await delay();
    const num = `WO-2026-${String(getDB().workOrders.length + 1).padStart(4, '0')}`;
    const item: WorkOrder = {
      id: uid('wo'),
      woNumber: num,
      incidentId: input.incidentId,
      assetCode: input.assetCode,
      laboratoryId: input.laboratoryId ?? '',
      technician: input.technician ?? 'Andi Wijaya',
      priority: input.priority ?? 'Normal',
      diagnosis: input.diagnosis ?? '',
      action: input.action ?? '',
      scheduledDate: input.scheduledDate ?? new Date().toISOString().split('T')[0],
      startTime: input.startTime,
      endTime: input.endTime,
      downtimeHours: input.downtimeHours,
      spareParts: input.spareParts ?? [],
      cost: input.cost ?? 0,
      testResult: input.testResult,
      notes: input.notes,
      status: input.status ?? 'Draft',
      timeline: [{ status: input.status ?? 'Draft', at: new Date().toISOString(), by: 'Admin Lab' }],
    };
    updateDB((db) => db.workOrders.unshift(item));
    logAudit({ userName: 'Admin', role: 'Teknisi', module: 'work-orders', action: 'create', object: item.woNumber, device: 'Web' });
    return item;
  },
  async update(id: string, input: Partial<WorkOrder>): Promise<WorkOrder | null> {
    await delay();
    let updated: WorkOrder | null = null;
    updateDB((db) => {
      const idx = db.workOrders.findIndex((w) => w.id === id);
      if (idx >= 0) {
        db.workOrders[idx] = { ...db.workOrders[idx], ...input };
        updated = db.workOrders[idx];
      }
    });
    return updated;
  },
  async updateStatus(id: string, status: WorkOrder['status'], by: string): Promise<WorkOrder | null> {
    await delay();
    let updated: WorkOrder | null = null;
    updateDB((db) => {
      const idx = db.workOrders.findIndex((w) => w.id === id);
      if (idx >= 0) {
        db.workOrders[idx].status = status;
        db.workOrders[idx].timeline.push({ status, at: new Date().toISOString(), by });
        if (status === 'In Progress' && !db.workOrders[idx].startTime) {
          db.workOrders[idx].startTime = new Date().toISOString();
        }
        if ((status === 'Completed' || status === 'Verified') && !db.workOrders[idx].endTime) {
          db.workOrders[idx].endTime = new Date().toISOString();
        }
        updated = db.workOrders[idx];
      }
    });
    return updated;
  },
  async useSparePart(id: string, part: WorkOrderSparePart): Promise<WorkOrder | null> {
    await delay();
    let updated: WorkOrder | null = null;
    updateDB((db) => {
      const idx = db.workOrders.findIndex((w) => w.id === id);
      if (idx >= 0) {
        db.workOrders[idx].spareParts.push(part);
        db.workOrders[idx].cost += part.quantity * (db.stock.items.find((s) => s.id === part.stockItemId)?.price ?? 0);
        // Deduct from stock
        const sIdx = db.stock.items.findIndex((s) => s.id === part.stockItemId);
        if (sIdx >= 0) {
          db.stock.items[sIdx].quantity = Math.max(0, db.stock.items[sIdx].quantity - part.quantity);
          db.stock.transactions.push({
            id: uid('stx'),
            itemId: part.stockItemId,
            type: 'out',
            quantity: part.quantity,
            date: new Date().toISOString().split('T')[0],
            reason: `Work order ${db.workOrders[idx].woNumber}`,
            by: db.workOrders[idx].technician,
          });
        }
        updated = db.workOrders[idx];
      }
    });
    return updated;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.workOrders = db.workOrders.filter((w) => w.id !== id);
    });
  },
};

// Stock
export const stockRepository = {
  async getItems(): Promise<StockItem[]> {
    await delay();
    return getDB().stock.items;
  },
  async getTransactions(): Promise<StockTransaction[]> {
    await delay();
    return getDB().stock.transactions;
  },
  async createItem(input: Partial<StockItem>): Promise<StockItem> {
    await delay();
    const item: StockItem = {
      id: uid('stk'),
      name: input.name ?? '',
      category: input.category ?? '',
      unit: input.unit ?? 'pcs',
      quantity: input.quantity ?? 0,
      minStock: input.minStock ?? 0,
      location: input.location ?? '',
      supplier: input.supplier ?? '',
      price: input.price ?? 0,
    };
    updateDB((db) => db.stock.items.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'stock', action: 'create', object: item.id, newValue: item.name, device: 'Web' });
    return item;
  },
  async updateItem(id: string, input: Partial<StockItem>): Promise<StockItem | null> {
    await delay();
    let updated: StockItem | null = null;
    updateDB((db) => {
      const idx = db.stock.items.findIndex((s) => s.id === id);
      if (idx >= 0) {
        db.stock.items[idx] = { ...db.stock.items[idx], ...input };
        updated = db.stock.items[idx];
      }
    });
    return updated;
  },
  async removeItem(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.stock.items = db.stock.items.filter((s) => s.id !== id);
    });
  },
  async addTransaction(input: Omit<StockTransaction, 'id'>): Promise<StockTransaction> {
    await delay();
    const tx: StockTransaction = { id: uid('stx'), ...input };
    updateDB((db) => {
      db.stock.transactions.unshift(tx);
      const idx = db.stock.items.findIndex((s) => s.id === input.itemId);
      if (idx >= 0) {
        const delta = input.type === 'in' ? input.quantity : input.type === 'out' ? -input.quantity : 0;
        db.stock.items[idx].quantity = Math.max(0, db.stock.items[idx].quantity + delta);
      }
    });
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'stock', action: input.type, object: input.itemId, newValue: String(input.quantity), device: 'Web' });
    return tx;
  },
};

// Loans
export const loanRepository = {
  async getAll(): Promise<Loan[]> {
    await delay();
    return getDB().loans;
  },
  async getById(id: string): Promise<Loan | null> {
    await delay();
    return getDB().loans.find((l) => l.id === id) ?? null;
  },
  async create(input: Partial<Loan>): Promise<Loan> {
    await delay();
    const item: Loan = {
      id: uid('loan'),
      borrowerName: input.borrowerName ?? '',
      unitOrClass: input.unitOrClass ?? '',
      itemName: input.itemName ?? '',
      quantity: input.quantity ?? 1,
      borrowDate: input.borrowDate ?? new Date().toISOString().split('T')[0],
      plannedReturn: input.plannedReturn ?? '',
      purpose: input.purpose ?? '',
      PIC: input.PIC ?? '',
      conditionOut: input.conditionOut ?? 'Baik',
      status: input.status ?? 'Draft',
    };
    updateDB((db) => db.loans.push(item));
    logAudit({ userName: 'Admin', role: 'Guru', module: 'loans', action: 'create', object: item.id, device: 'Web' });
    return item;
  },
  async update(id: string, input: Partial<Loan>): Promise<Loan | null> {
    await delay();
    let updated: Loan | null = null;
    updateDB((db) => {
      const idx = db.loans.findIndex((l) => l.id === id);
      if (idx >= 0) {
        db.loans[idx] = { ...db.loans[idx], ...input };
        updated = db.loans[idx];
      }
    });
    return updated;
  },
  async returnLoan(id: string, condition: Loan['conditionReturn'], notes?: string): Promise<Loan | null> {
    await delay();
    let updated: Loan | null = null;
    updateDB((db) => {
      const idx = db.loans.findIndex((l) => l.id === id);
      if (idx >= 0) {
        db.loans[idx].status = 'Diperiksa';
        db.loans[idx].actualReturn = new Date().toISOString().split('T')[0];
        db.loans[idx].conditionReturn = condition;
        if (notes) db.loans[idx].notes = notes;
        updated = db.loans[idx];
      }
    });
    return updated;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.loans = db.loans.filter((l) => l.id !== id);
    });
  },
};

// Maintenance
export const maintenanceRepository = {
  async getPlans(): Promise<MaintenancePlan[]> {
    await delay();
    return getDB().maintenance.plans;
  },
  async getExecutions(): Promise<MaintenanceExecution[]> {
    await delay();
    return getDB().maintenance.executions;
  },
  async createPlan(input: Partial<MaintenancePlan>): Promise<MaintenancePlan> {
    await delay();
    const item: MaintenancePlan = {
      id: uid('mp'),
      name: input.name ?? '',
      assetCategory: input.assetCategory ?? '',
      laboratoryId: input.laboratoryId ?? '',
      frequency: input.frequency ?? 'bulanan',
      checklist: input.checklist ?? [],
      technician: input.technician ?? '',
      nextSchedule: input.nextSchedule ?? '',
      status: input.status ?? 'active',
    };
    updateDB((db) => db.maintenance.plans.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'maintenance', action: 'create', object: item.id, newValue: item.name, device: 'Web' });
    return item;
  },
  async updatePlan(id: string, input: Partial<MaintenancePlan>): Promise<MaintenancePlan | null> {
    await delay();
    let updated: MaintenancePlan | null = null;
    updateDB((db) => {
      const idx = db.maintenance.plans.findIndex((p) => p.id === id);
      if (idx >= 0) {
        db.maintenance.plans[idx] = { ...db.maintenance.plans[idx], ...input };
        updated = db.maintenance.plans[idx];
      }
    });
    return updated;
  },
  async removePlan(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.maintenance.plans = db.maintenance.plans.filter((p) => p.id !== id);
    });
  },
  async createExecution(input: Partial<MaintenanceExecution>): Promise<MaintenanceExecution> {
    await delay();
    const item: MaintenanceExecution = {
      id: uid('me'),
      planId: input.planId,
      assetCode: input.assetCode ?? '',
      laboratoryId: input.laboratoryId ?? '',
      technician: input.technician ?? '',
      date: input.date ?? new Date().toISOString().split('T')[0],
      checklist: input.checklist ?? [],
      findings: input.findings ?? '',
      action: input.action ?? '',
      spareParts: input.spareParts ?? [],
      conditionBefore: input.conditionBefore ?? 'Baik',
      conditionAfter: input.conditionAfter ?? 'Baik',
      nextSchedule: input.nextSchedule ?? '',
    };
    updateDB((db) => db.maintenance.executions.unshift(item));
    logAudit({ userName: 'Admin', role: 'Teknisi', module: 'maintenance', action: 'execute', object: item.id, device: 'Web' });
    return item;
  },
  async removeExecution(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.maintenance.executions = db.maintenance.executions.filter((e) => e.id !== id);
    });
  },
};

// Calendar
export const calendarRepository = {
  async getAll(): Promise<CalendarEvent[]> {
    await delay();
    return getDB().calendarEvents;
  },
  async create(input: Partial<CalendarEvent>): Promise<CalendarEvent> {
    await delay();
    const item: CalendarEvent = {
      id: uid('cal'),
      title: input.title ?? '',
      date: input.date ?? new Date().toISOString().split('T')[0],
      endDate: input.endDate,
      category: input.category ?? 'lainnya',
      description: input.description,
    };
    updateDB((db) => db.calendarEvents.push(item));
    logAudit({ userName: 'Admin', role: 'Admin Lab', module: 'calendar', action: 'create', object: item.id, newValue: item.title, device: 'Web' });
    return item;
  },
  async update(id: string, input: Partial<CalendarEvent>): Promise<CalendarEvent | null> {
    await delay();
    let updated: CalendarEvent | null = null;
    updateDB((db) => {
      const idx = db.calendarEvents.findIndex((c) => c.id === id);
      if (idx >= 0) {
        db.calendarEvents[idx] = { ...db.calendarEvents[idx], ...input };
        updated = db.calendarEvents[idx];
      }
    });
    return updated;
  },
  async remove(id: string): Promise<void> {
    await delay();
    updateDB((db) => {
      db.calendarEvents = db.calendarEvents.filter((c) => c.id !== id);
    });
  },
};

// Notifications
export const notificationRepository = {
  async getAll(): Promise<Notification[]> {
    await delay(80);
    return getDB().notifications;
  },
  async markRead(id: string): Promise<void> {
    updateDB((db) => {
      const n = db.notifications.find((x) => x.id === id);
      if (n) n.read = true;
    });
  },
  async markAllRead(): Promise<void> {
    updateDB((db) => db.notifications.forEach((n) => (n.read = true)));
  },
  async remove(id: string): Promise<void> {
    updateDB((db) => {
      db.notifications = db.notifications.filter((n) => n.id !== id);
    });
  },
};

// Users
export const userRepository: Repository<User> = {
  async getAll() {
    await delay();
    return getDB().users;
  },
  async getById(id) {
    await delay();
    return getDB().users.find((u) => u.id === id) ?? null;
  },
  async create(input) {
    await delay();
    const item: User = {
      id: uid('u'),
      name: input.name ?? '',
      email: input.email ?? '',
      nip: input.nip,
      nis: input.nis,
      role: input.role ?? 'Siswa',
      unit: input.unit,
      phone: input.phone,
      status: input.status ?? 'active',
      lastLogin: input.lastLogin,
    };
    updateDB((db) => db.users.push(item));
    logAudit({ userName: 'Admin', role: 'Super Admin', module: 'users', action: 'create', object: item.id, newValue: item.name, device: 'Web' });
    return item;
  },
  async update(id, input) {
    await delay();
    let updated: User | null = null;
    updateDB((db) => {
      const idx = db.users.findIndex((u) => u.id === id);
      if (idx >= 0) {
        db.users[idx] = { ...db.users[idx], ...input };
        updated = db.users[idx];
      }
    });
    return updated!;
  },
  async remove(id) {
    await delay();
    updateDB((db) => {
      db.users = db.users.filter((u) => u.id !== id);
    });
    logAudit({ userName: 'Admin', role: 'Super Admin', module: 'users', action: 'delete', object: id, device: 'Web' });
  },
};

export interface MasterDataActorContext {
  user: Pick<User, 'name' | 'role'>;
  permissions: PermissionMatrix;
}

interface MasterDataInput {
  name?: string;
  code?: string;
  isActive?: boolean;
}

function assertMasterDataPermission(context: MasterDataActorContext, action: 'create' | 'update' | 'delete'): void {
  if (!can(context.permissions, context.user.role, 'master-data', action)) {
    throw new Error(`Anda tidak memiliki izin ${action} untuk master data`);
  }
}

function requiredString(value: string | undefined, field: string): string {
  const normalized = value?.trim() ?? '';
  if (!normalized) throw new Error(`${field} wajib diisi`);
  return normalized;
}

function optionalCode(value: string | undefined): string | undefined {
  const code = value?.trim() ?? '';
  return code || undefined;
}

function duplicateMasterDataName(items: MasterDataItem[], name: string, excludeId?: string): boolean {
  return items.some((item) => item.id !== excludeId && item.name.trim().toLowerCase() === name.toLowerCase());
}

function duplicateMasterDataCode(items: MasterDataItem[], code: string | undefined, excludeId?: string): boolean {
  if (!code) return false;
  return items.some((item) => item.id !== excludeId && item.code?.trim().toLowerCase() === code.toLowerCase());
}

function masterDataAuditObject(category: string, id: string, name: string): string {
  return `${category}:${id} (${name})`;
}

function labReferences(db: ReturnType<typeof getDB>, laboratoryId: string): string[] {
  const references: [string, number][] = [
    ['device', db.devices.filter((item) => item.laboratoryId === laboratoryId).length],
    ['asset', db.assets.filter((item) => item.laboratoryId === laboratoryId).length],
    ['schedule', db.schedules.filter((item) => item.laboratoryId === laboratoryId).length],
    ['booking', db.bookings.filter((item) => item.laboratoryId === laboratoryId).length],
    ['session', db.sessions.filter((item) => item.laboratoryId === laboratoryId).length],
    ['incident', db.incidents.filter((item) => item.laboratoryId === laboratoryId).length],
    ['work order', db.workOrders.filter((item) => item.laboratoryId === laboratoryId).length],
    ['maintenance plan', db.maintenance.plans.filter((item) => item.laboratoryId === laboratoryId).length],
    ['maintenance execution', db.maintenance.executions.filter((item) => item.laboratoryId === laboratoryId).length],
  ];
  return references.filter(([, count]) => count > 0).map(([label, count]) => `${label} (${count})`);
}

export const masterDataRepository = {
  listCategories(): MasterDataCategoryKey[] {
    return [...MASTER_DATA_CATEGORY_KEYS];
  },

  async listItems(category: MasterDataCategoryKey): Promise<MasterDataItem[]> {
    await delay(100);
    return getDB().masterData[category].map((item) => ({ ...item }));
  },

  async getItem(category: MasterDataCategoryKey, id: string): Promise<MasterDataItem | null> {
    await delay(100);
    const item = getDB().masterData[category].find((candidate) => candidate.id === id);
    return item ? { ...item } : null;
  },

  async createItem(category: MasterDataCategoryKey, input: MasterDataInput, context: MasterDataActorContext): Promise<MasterDataItem> {
    assertMasterDataPermission(context, 'create');
    await delay(100);
    const name = requiredString(input.name, 'Nama');
    const code = optionalCode(input.code);
    const item: MasterDataItem = {
      id: uid('md'),
      category,
      name,
      code,
      isActive: input.isActive ?? true,
      createdAt: new Date().toISOString(),
    };
    updateDB((db) => {
      const items = db.masterData[category];
      if (duplicateMasterDataName(items, name)) throw new Error(`Nama "${name}" sudah ada pada kategori ini`);
      if (duplicateMasterDataCode(items, code)) throw new Error(`Kode "${code}" sudah ada pada kategori ini`);
      items.push(item);
    });
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'create', object: masterDataAuditObject(category, item.id, item.name), newValue: JSON.stringify(item), device: 'Web' });
    return { ...item };
  },

  async updateItem(category: MasterDataCategoryKey, id: string, input: MasterDataInput, context: MasterDataActorContext): Promise<MasterDataItem> {
    assertMasterDataPermission(context, 'update');
    await delay(100);
    let updated: MasterDataItem | undefined;
    let previous: MasterDataItem | undefined;
    updateDB((db) => {
      const items = db.masterData[category];
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) throw new Error('Data master tidak ditemukan');
      const current = items[idx];
      const name = input.name === undefined ? current.name : requiredString(input.name, 'Nama');
      const code = input.code === undefined ? current.code : optionalCode(input.code);
      if (duplicateMasterDataName(items, name, id)) throw new Error(`Nama "${name}" sudah ada pada kategori ini`);
      if (duplicateMasterDataCode(items, code, id)) throw new Error(`Kode "${code}" sudah ada pada kategori ini`);
      previous = { ...current };
      updated = items[idx] = { ...current, name, code, isActive: input.isActive ?? current.isActive, updatedAt: new Date().toISOString() };
    });
    if (!updated || !previous) throw new Error('Data master tidak dapat diperbarui');
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'update', object: masterDataAuditObject(category, updated.id, updated.name), oldValue: JSON.stringify(previous), newValue: JSON.stringify(updated), device: 'Web' });
    return { ...updated };
  },

  async deleteItem(category: MasterDataCategoryKey, id: string, context: MasterDataActorContext): Promise<void> {
    assertMasterDataPermission(context, 'delete');
    await delay(100);
    let removed: MasterDataItem | undefined;
    updateDB((db) => {
      const items = db.masterData[category];
      const idx = items.findIndex((item) => item.id === id);
      if (idx < 0) throw new Error('Data master tidak ditemukan');
      removed = items[idx];
      items.splice(idx, 1);
    });
    if (!removed) throw new Error('Data master tidak dapat dihapus');
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'delete', object: masterDataAuditObject(category, removed.id, removed.name), oldValue: JSON.stringify(removed), device: 'Web' });
  },

  async createLaboratory(input: Partial<Laboratory>, context: MasterDataActorContext): Promise<Laboratory> {
    assertMasterDataPermission(context, 'create');
    await delay(100);
    const name = requiredString(input.name, 'Nama');
    const code = requiredString(input.code, 'Kode');
    const created: Laboratory = {
      id: uid('lab'),
      name,
      code,
      location: input.location?.trim() ?? '',
      capacity: input.capacity ?? 36,
      headName: input.headName?.trim() ?? '',
      technicianName: input.technicianName?.trim() ?? '',
      pcCount: input.pcCount ?? 0,
      status: input.status ?? 'active',
      layoutRows: input.layoutRows ?? 6,
      layoutCols: input.layoutCols ?? 6,
    };
    updateDB((db) => {
      if (db.labs.some((lab) => lab.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`Nama laboratorium "${name}" sudah ada`);
      if (db.labs.some((lab) => lab.code.trim().toLowerCase() === code.toLowerCase())) throw new Error(`Kode laboratorium "${code}" sudah ada`);
      db.labs.push(created);
    });
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'create', object: masterDataAuditObject('laboratory', created.id, created.name), newValue: JSON.stringify(created), device: 'Web' });
    return { ...created };
  },

  async updateLaboratory(id: string, input: Partial<Laboratory>, context: MasterDataActorContext): Promise<Laboratory> {
    assertMasterDataPermission(context, 'update');
    await delay(100);
    let updated: Laboratory | undefined;
    let previous: Laboratory | undefined;
    updateDB((db) => {
      const idx = db.labs.findIndex((lab) => lab.id === id);
      if (idx < 0) throw new Error('Laboratorium tidak ditemukan');
      const current = db.labs[idx];
      const name = input.name === undefined ? current.name : requiredString(input.name, 'Nama');
      const code = input.code === undefined ? current.code : requiredString(input.code, 'Kode');
      if (db.labs.some((lab) => lab.id !== id && lab.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(`Nama laboratorium "${name}" sudah ada`);
      if (db.labs.some((lab) => lab.id !== id && lab.code.trim().toLowerCase() === code.toLowerCase())) throw new Error(`Kode laboratorium "${code}" sudah ada`);
      previous = { ...current };
      updated = db.labs[idx] = { ...current, name, code };
    });
    if (!updated || !previous) throw new Error('Laboratorium tidak dapat diperbarui');
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'update', object: masterDataAuditObject('laboratory', updated.id, updated.name), oldValue: JSON.stringify(previous), newValue: JSON.stringify(updated), device: 'Web' });
    return { ...updated };
  },

  async deleteLaboratory(id: string, context: MasterDataActorContext): Promise<void> {
    assertMasterDataPermission(context, 'delete');
    await delay(100);
    let removed: Laboratory | undefined;
    updateDB((db) => {
      const idx = db.labs.findIndex((lab) => lab.id === id);
      if (idx < 0) throw new Error('Laboratorium tidak ditemukan');
      const references = labReferences(db, id);
      if (references.length > 0) throw new Error(`Laboratorium "${db.labs[idx].name}" masih digunakan oleh ${references.join(', ')}`);
      removed = db.labs[idx];
      db.labs.splice(idx, 1);
    });
    if (!removed) throw new Error('Laboratorium tidak dapat dihapus');
    logAudit({ userName: context.user.name, role: context.user.role, module: 'master-data', action: 'delete', object: masterDataAuditObject('laboratory', removed.id, removed.name), oldValue: JSON.stringify(removed), device: 'Web' });
  },
};

export const frequencyList: MaintenanceFrequency[] = ['mingguan', 'bulanan', 'tiga bulanan', 'semester', 'tahunan', 'custom'];
