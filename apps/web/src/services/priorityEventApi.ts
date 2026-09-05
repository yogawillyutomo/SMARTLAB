import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type PriorityEventStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';
export type PriorityEventCategory = 'school_event' | 'exam' | 'competition' | 'official_visit' | 'emergency' | 'other';
export type PriorityEventEventType =
  | 'priority_event.submitted'
  | 'priority_event.approved'
  | 'priority_event.rejected'
  | 'priority_event.cancelled';

export interface PriorityEventLaboratoryDto {
  id: string;
  code: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
}

export interface PriorityEventRequesterDto {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
}

export interface PriorityEventTimelineDto {
  eventType: PriorityEventEventType;
  actorName: string;
  at: string;
  payload: Record<string, unknown>;
  versionBefore: number;
  versionAfter: number;
}

export interface PriorityEventDto {
  id: string;
  schoolId: string;
  eventNumber: string;
  laboratory: PriorityEventLaboratoryDto;
  requester: PriorityEventRequesterDto;
  date: string;
  startsAt: string;
  endsAt: string;
  category: PriorityEventCategory;
  title: string;
  participants: number;
  description: string | null;
  picName: string;
  status: PriorityEventStatus;
  rejectionReason: string | null;
  version: number;
  decidedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: PriorityEventTimelineDto[];
}

export interface CreatePriorityEventInput {
  laboratoryId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  category: PriorityEventCategory;
  title: string;
  participants: number;
  description?: string | null;
  picName: string;
}

export interface PriorityEventFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  status?: PriorityEventStatus;
  scope?: 'mine' | 'all';
  page?: number;
  perPage?: number;
}

export interface PriorityEventPage {
  data: PriorityEventDto[];
  meta: { page:number; perPage:number; total:number; lastPage:number; from:string; to:string };
}

export interface PriorityEventGateway {
  list: (filters:PriorityEventFilters)=>Promise<PriorityEventPage>;
  listAll: (filters:Omit<PriorityEventFilters,'page'|'perPage'>)=>Promise<PriorityEventDto[]>;
  show: (id:string)=>Promise<PriorityEventDto>;
  create: (input:CreatePriorityEventInput)=>Promise<PriorityEventDto>;
  approve: (id:string,version:number)=>Promise<PriorityEventDto>;
  reject: (id:string,version:number,reason:string)=>Promise<PriorityEventDto>;
  cancel: (id:string,version:number,reason:string)=>Promise<PriorityEventDto>;
}

export class PriorityEventContractError extends Error {
  constructor(message='Respons Priority Event tidak sesuai kontrak API.'){
    super(message);
    this.name='PriorityEventContractError';
  }
}

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const EVENT_TYPES:PriorityEventEventType[]=['priority_event.submitted','priority_event.approved','priority_event.rejected','priority_event.cancelled'];
const STATUSES:PriorityEventStatus[]=['submitted','approved','rejected','cancelled'];
const CATEGORIES:PriorityEventCategory[]=['school_event','exam','competition','official_visit','emergency','other'];

function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function string(v:unknown):v is string{return typeof v==='string';}
function positive(v:unknown):v is number{return Number.isSafeInteger(v)&&(v as number)>0;}
function nonnegative(v:unknown):v is number{return Number.isSafeInteger(v)&&(v as number)>=0;}
function datetime(v:unknown):v is string{return string(v)&&!Number.isNaN(Date.parse(v));}
function nullableString(v:unknown):v is string|null{return v===null||string(v);}

function parseLab(v:unknown):PriorityEventLaboratoryDto{
  if(!record(v)||!string(v.id)||!isUlid(v.id)||!string(v.code)||!string(v.name)||!positive(v.capacity)||!['active','inactive'].includes(String(v.status)))throw new PriorityEventContractError();
  return {id:v.id,code:v.code,name:v.name,capacity:v.capacity,status:v.status as 'active'|'inactive'};
}

function parseRequester(v:unknown):PriorityEventRequesterDto{
  if(!record(v)||!string(v.userId)||!isUlid(v.userId)||!string(v.membershipId)||!isUlid(v.membershipId)||!string(v.name)||!string(v.email))throw new PriorityEventContractError();
  return {userId:v.userId,membershipId:v.membershipId,name:v.name,email:v.email};
}

function parseTimeline(v:unknown):PriorityEventTimelineDto{
  if(!record(v)||!EVENT_TYPES.includes(v.eventType as PriorityEventEventType)||!string(v.actorName)||!datetime(v.at)||!record(v.payload)||!nonnegative(v.versionBefore)||!positive(v.versionAfter))throw new PriorityEventContractError();
  return {
    eventType:v.eventType as PriorityEventEventType,
    actorName:v.actorName,
    at:v.at,
    payload:v.payload,
    versionBefore:v.versionBefore,
    versionAfter:v.versionAfter,
  };
}

export function parsePriorityEvent(v:unknown):PriorityEventDto{
  if(!record(v)
    ||!string(v.id)||!isUlid(v.id)
    ||!string(v.schoolId)||!isUlid(v.schoolId)
    ||!string(v.eventNumber)
    ||!string(v.date)||!DATE.test(v.date)
    ||!string(v.startsAt)||!TIME.test(v.startsAt)
    ||!string(v.endsAt)||!TIME.test(v.endsAt)
    ||v.startsAt>=v.endsAt
    ||!CATEGORIES.includes(v.category as PriorityEventCategory)
    ||!string(v.title)||v.title.trim()===''
    ||!positive(v.participants)
    ||!nullableString(v.description)
    ||!string(v.picName)||v.picName.trim()===''
    ||!STATUSES.includes(v.status as PriorityEventStatus)
    ||!nullableString(v.rejectionReason)
    ||!positive(v.version)
    ||!Array.isArray(v.timeline)
    ||!datetime(v.createdAt)
    ||!datetime(v.updatedAt)) throw new PriorityEventContractError();

  for(const field of ['decidedAt','cancelledAt'] as const){
    const value=v[field];
    if(value!==null&&!datetime(value))throw new PriorityEventContractError();
  }

  return {
    id:v.id,
    schoolId:v.schoolId,
    eventNumber:v.eventNumber,
    laboratory:parseLab(v.laboratory),
    requester:parseRequester(v.requester),
    date:v.date,
    startsAt:v.startsAt,
    endsAt:v.endsAt,
    category:v.category as PriorityEventCategory,
    title:v.title,
    participants:v.participants,
    description:v.description as string|null,
    picName:v.picName,
    status:v.status as PriorityEventStatus,
    rejectionReason:v.rejectionReason as string|null,
    version:v.version,
    decidedAt:v.decidedAt as string|null,
    cancelledAt:v.cancelledAt as string|null,
    createdAt:v.createdAt,
    updatedAt:v.updatedAt,
    timeline:v.timeline.map(parseTimeline),
  };
}

function parseEnvelope(v:unknown):PriorityEventDto{
  if(!record(v)||!('data'in v))throw new PriorityEventContractError();
  return parsePriorityEvent(v.data);
}

function validDate(v:string):boolean{
  if(!DATE.test(v))return false;
  const [y,m,d]=v.split('-').map(Number);
  const date=new Date(y,m-1,d);
  return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;
}

function assertRange(from:string,to:string):void{
  if(!validDate(from)||!validDate(to)||from>to)throw new PriorityEventContractError('Rentang Priority Event tidak valid.');
  const [fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
  if((Date.UTC(ty,tm-1,td)-Date.UTC(fy,fm-1,fd))/86_400_000>365)throw new PriorityEventContractError('Rentang Priority Event maksimal 366 hari.');
}

function pathId(id:string):string{
  if(!isUlid(id))throw new PriorityEventContractError('ID Priority Event tidak valid.');
  return encodeURIComponent(id);
}

function listPath(filters:PriorityEventFilters):string{
  assertRange(filters.from,filters.to);
  const q=new URLSearchParams({from:filters.from,to:filters.to});
  if(filters.laboratoryId){
    if(!isUlid(filters.laboratoryId))throw new PriorityEventContractError();
    q.set('laboratoryId',filters.laboratoryId);
  }
  if(filters.status){
    if(!STATUSES.includes(filters.status))throw new PriorityEventContractError();
    q.set('status',filters.status);
  }
  if(filters.scope)q.set('scope',filters.scope);
  if(filters.page!==undefined){
    if(!positive(filters.page))throw new PriorityEventContractError();
    q.set('page',String(filters.page));
  }
  if(filters.perPage!==undefined){
    if(!positive(filters.perPage)||filters.perPage>500)throw new PriorityEventContractError();
    q.set('perPage',String(filters.perPage));
  }
  return `/priority-events?${q.toString()}`;
}

function parsePage(v:unknown):PriorityEventPage{
  if(!record(v)||!Array.isArray(v.data)||!record(v.meta))throw new PriorityEventContractError();
  const {page,perPage,total,lastPage,from,to}=v.meta;
  if(!positive(page)||!positive(perPage)||!nonnegative(total)||!positive(lastPage)||!string(from)||!string(to)||!validDate(from)||!validDate(to))throw new PriorityEventContractError();
  const data=v.data.map(parsePriorityEvent);
  if(data.length>perPage||data.length>total||page>lastPage)throw new PriorityEventContractError();
  return {data,meta:{page,perPage,total,lastPage,from,to}};
}

export function createPriorityEventGateway(client:ApiClient):PriorityEventGateway{
  const list:PriorityEventGateway['list']=async(filters)=>parsePage(await client.get<unknown>(listPath(filters)));

  return {
    list,
    async listAll(filters){
      const first=await list({...filters,page:1,perPage:500});
      if(first.meta.lastPage>20)throw new PriorityEventContractError('Terlalu banyak Priority Event untuk dimuat sekaligus.');
      const pages=[first];
      for(let page=2;page<=first.meta.lastPage;page+=1){
        const next=await list({...filters,page,perPage:500});
        if(next.meta.total!==first.meta.total||next.meta.lastPage!==first.meta.lastPage||next.meta.from!==first.meta.from||next.meta.to!==first.meta.to)throw new PriorityEventContractError('Pagination Priority Event berubah selama pembacaan.');
        pages.push(next);
      }
      const data=pages.flatMap((p)=>p.data);
      if(data.length!==first.meta.total)throw new PriorityEventContractError('Koleksi Priority Event tidak lengkap.');
      return data;
    },
    async show(id){return parseEnvelope(await client.get<unknown>(`/priority-events/${pathId(id)}`));},
    async create(input){return parseEnvelope(await client.post<unknown>('/priority-events',input));},
    async approve(id,version){return parseEnvelope(await client.post<unknown>(`/priority-events/${pathId(id)}/approve`,undefined,{ifMatch:`"${version}"`}));},
    async reject(id,version,reason){return parseEnvelope(await client.post<unknown>(`/priority-events/${pathId(id)}/reject`,{reason:reason.trim()},{ifMatch:`"${version}"`}));},
    async cancel(id,version,reason){return parseEnvelope(await client.post<unknown>(`/priority-events/${pathId(id)}/cancel`,{reason:reason.trim()},{ifMatch:`"${version}"`}));},
  };
}

export const priorityEventGateway=createPriorityEventGateway(apiClient);
