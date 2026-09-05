import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type LaboratoryReservationStatus = 'submitted' | 'approved' | 'rejected' | 'cancelled';
export type LaboratoryReservationEventType =
  | 'reservation.submitted'
  | 'reservation.approved'
  | 'reservation.rejected'
  | 'reservation.cancelled';

export interface ReservationLaboratoryDto {
  id: string;
  code: string;
  name: string;
  capacity: number;
  status: 'active' | 'inactive';
}

export interface ReservationRequesterDto {
  userId: string;
  membershipId: string;
  name: string;
  email: string;
}

export interface LaboratoryReservationTimelineDto {
  eventType: LaboratoryReservationEventType;
  actorName: string;
  at: string;
  payload: Record<string, unknown>;
  versionBefore: number;
  versionAfter: number;
}

export interface LaboratoryReservationDto {
  id: string;
  schoolId: string;
  reservationNumber: string;
  laboratory: ReservationLaboratoryDto;
  requester: ReservationRequesterDto;
  date: string;
  startsAt: string;
  endsAt: string;
  activity: string;
  participants: number;
  deviceNeeds: string | null;
  notes: string | null;
  picName: string;
  status: LaboratoryReservationStatus;
  rejectionReason: string | null;
  version: number;
  decidedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  timeline: LaboratoryReservationTimelineDto[];
}

export interface CreateLaboratoryReservationInput {
  laboratoryId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  activity: string;
  participants: number;
  deviceNeeds?: string | null;
  notes?: string | null;
  picName: string;
}

export interface LaboratoryReservationFilters {
  from: string;
  to: string;
  laboratoryId?: string;
  status?: LaboratoryReservationStatus;
  scope?: 'mine' | 'all';
  page?: number;
  perPage?: number;
}

export interface LaboratoryReservationPage {
  data: LaboratoryReservationDto[];
  meta: { page:number; perPage:number; total:number; lastPage:number; from:string; to:string };
}

export interface LaboratoryReservationGateway {
  list: (filters:LaboratoryReservationFilters)=>Promise<LaboratoryReservationPage>;
  listAll: (filters:Omit<LaboratoryReservationFilters,'page'|'perPage'>)=>Promise<LaboratoryReservationDto[]>;
  show: (id:string)=>Promise<LaboratoryReservationDto>;
  create: (input:CreateLaboratoryReservationInput)=>Promise<LaboratoryReservationDto>;
  approve: (id:string,version:number)=>Promise<LaboratoryReservationDto>;
  reject: (id:string,version:number,reason:string)=>Promise<LaboratoryReservationDto>;
  cancel: (id:string,version:number,reason:string)=>Promise<LaboratoryReservationDto>;
}

export class LaboratoryReservationContractError extends Error {
  constructor(message='Respons reservasi laboratorium tidak sesuai kontrak API.'){
    super(message);
    this.name='LaboratoryReservationContractError';
  }
}

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const EVENT_TYPES:LaboratoryReservationEventType[]=['reservation.submitted','reservation.approved','reservation.rejected','reservation.cancelled'];
const STATUSES:LaboratoryReservationStatus[]=['submitted','approved','rejected','cancelled'];

function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function string(v:unknown):v is string{return typeof v==='string';}
function positive(v:unknown):v is number{return Number.isSafeInteger(v)&&(v as number)>0;}
function nonnegative(v:unknown):v is number{return Number.isSafeInteger(v)&&(v as number)>=0;}
function datetime(v:unknown):v is string{return string(v)&&!Number.isNaN(Date.parse(v));}
function nullableString(v:unknown):v is string|null{return v===null||string(v);}

function parseLab(v:unknown):ReservationLaboratoryDto{
  if(!record(v)||!string(v.id)||!isUlid(v.id)||!string(v.code)||!string(v.name)||!positive(v.capacity)||!['active','inactive'].includes(String(v.status)))throw new LaboratoryReservationContractError();
  return {id:v.id,code:v.code,name:v.name,capacity:v.capacity,status:v.status as 'active'|'inactive'};
}
function parseRequester(v:unknown):ReservationRequesterDto{
  if(!record(v)||!string(v.userId)||!isUlid(v.userId)||!string(v.membershipId)||!isUlid(v.membershipId)||!string(v.name)||!string(v.email))throw new LaboratoryReservationContractError();
  return {userId:v.userId,membershipId:v.membershipId,name:v.name,email:v.email};
}
function parseTimeline(v:unknown):LaboratoryReservationTimelineDto{
  if(!record(v)||!EVENT_TYPES.includes(v.eventType as LaboratoryReservationEventType)||!string(v.actorName)||!datetime(v.at)||!record(v.payload)||!nonnegative(v.versionBefore)||!positive(v.versionAfter))throw new LaboratoryReservationContractError();
  return {eventType:v.eventType as LaboratoryReservationEventType,actorName:v.actorName,at:v.at,payload:v.payload,versionBefore:v.versionBefore,versionAfter:v.versionAfter};
}
export function parseLaboratoryReservation(v:unknown):LaboratoryReservationDto{
  if(!record(v)||!string(v.id)||!isUlid(v.id)||!string(v.schoolId)||!isUlid(v.schoolId)||!string(v.reservationNumber)||!DATE.test(String(v.date))||!TIME.test(String(v.startsAt))||!TIME.test(String(v.endsAt))||String(v.startsAt)>=String(v.endsAt))throw new LaboratoryReservationContractError();
  if(!string(v.activity)||v.activity.trim()===''||!positive(v.participants)||!nullableString(v.deviceNeeds)||!nullableString(v.notes)||!string(v.picName)||v.picName.trim()===''||!STATUSES.includes(v.status as LaboratoryReservationStatus)||!nullableString(v.rejectionReason)||!positive(v.version)||!Array.isArray(v.timeline))throw new LaboratoryReservationContractError();
  for(const field of ['decidedAt','cancelledAt'] as const){const value=v[field];if(value!==null&&!datetime(value))throw new LaboratoryReservationContractError();}
  if(!datetime(v.createdAt)||!datetime(v.updatedAt))throw new LaboratoryReservationContractError();
  const timeline=v.timeline.map(parseTimeline);
  return {
    id:v.id,schoolId:v.schoolId,reservationNumber:v.reservationNumber,laboratory:parseLab(v.laboratory),requester:parseRequester(v.requester),
    date:v.date as string,startsAt:v.startsAt as string,endsAt:v.endsAt as string,activity:v.activity,participants:v.participants,
    deviceNeeds:v.deviceNeeds as string|null,notes:v.notes as string|null,picName:v.picName,status:v.status as LaboratoryReservationStatus,
    rejectionReason:v.rejectionReason as string|null,version:v.version,decidedAt:v.decidedAt as string|null,cancelledAt:v.cancelledAt as string|null,
    createdAt:v.createdAt,updatedAt:v.updatedAt,timeline,
  };
}
function parseEnvelope(v:unknown):LaboratoryReservationDto{
  if(!record(v)||!('data'in v))throw new LaboratoryReservationContractError();
  return parseLaboratoryReservation(v.data);
}
function validDate(v:string):boolean{
  if(!DATE.test(v))return false;
  const [y,m,d]=v.split('-').map(Number);const date=new Date(y,m-1,d);
  return date.getFullYear()===y&&date.getMonth()===m-1&&date.getDate()===d;
}
function assertRange(from:string,to:string):void{
  if(!validDate(from)||!validDate(to)||from>to)throw new LaboratoryReservationContractError('Rentang reservasi tidak valid.');
  const [fy,fm,fd]=from.split('-').map(Number),[ty,tm,td]=to.split('-').map(Number);
  if((Date.UTC(ty,tm-1,td)-Date.UTC(fy,fm-1,fd))/86_400_000>365)throw new LaboratoryReservationContractError('Rentang reservasi maksimal 366 hari.');
}
function pathId(id:string):string{if(!isUlid(id))throw new LaboratoryReservationContractError('ID reservasi tidak valid.');return encodeURIComponent(id);}
function listPath(filters:LaboratoryReservationFilters):string{
  assertRange(filters.from,filters.to);
  const q=new URLSearchParams({from:filters.from,to:filters.to});
  if(filters.laboratoryId){if(!isUlid(filters.laboratoryId))throw new LaboratoryReservationContractError();q.set('laboratoryId',filters.laboratoryId);}
  if(filters.status){if(!STATUSES.includes(filters.status))throw new LaboratoryReservationContractError();q.set('status',filters.status);}
  if(filters.scope)q.set('scope',filters.scope);
  if(filters.page!==undefined){if(!positive(filters.page))throw new LaboratoryReservationContractError();q.set('page',String(filters.page));}
  if(filters.perPage!==undefined){if(!positive(filters.perPage)||filters.perPage>500)throw new LaboratoryReservationContractError();q.set('perPage',String(filters.perPage));}
  return `/laboratory-reservations?${q.toString()}`;
}
function parsePage(v:unknown):LaboratoryReservationPage{
  if(!record(v)||!Array.isArray(v.data)||!record(v.meta))throw new LaboratoryReservationContractError();
  const {page,perPage,total,lastPage,from,to}=v.meta;
  if(!positive(page)||!positive(perPage)||!nonnegative(total)||!positive(lastPage)||!string(from)||!string(to)||!validDate(from)||!validDate(to))throw new LaboratoryReservationContractError();
  const data=v.data.map(parseLaboratoryReservation);
  if(data.length>perPage||data.length>total||page>lastPage)throw new LaboratoryReservationContractError();
  return {data,meta:{page,perPage,total,lastPage,from,to}};
}

export function createLaboratoryReservationGateway(client:ApiClient):LaboratoryReservationGateway{
  const list:LaboratoryReservationGateway['list']=async(filters)=>parsePage(await client.get<unknown>(listPath(filters)));
  return {
    list,
    async listAll(filters){
      const first=await list({...filters,page:1,perPage:500});
      if(first.meta.lastPage>20)throw new LaboratoryReservationContractError('Terlalu banyak reservasi untuk dimuat sekaligus.');
      const pages=[first];
      for(let page=2;page<=first.meta.lastPage;page+=1){
        const next=await list({...filters,page,perPage:500});
        if(next.meta.total!==first.meta.total||next.meta.lastPage!==first.meta.lastPage||next.meta.from!==first.meta.from||next.meta.to!==first.meta.to)throw new LaboratoryReservationContractError('Pagination reservasi berubah selama pembacaan.');
        pages.push(next);
      }
      const data=pages.flatMap((p)=>p.data);
      if(data.length!==first.meta.total)throw new LaboratoryReservationContractError('Koleksi reservasi tidak lengkap.');
      return data;
    },
    async show(id){return parseEnvelope(await client.get<unknown>(`/laboratory-reservations/${pathId(id)}`));},
    async create(input){return parseEnvelope(await client.post<unknown>('/laboratory-reservations',input));},
    async approve(id,version){return parseEnvelope(await client.post<unknown>(`/laboratory-reservations/${pathId(id)}/approve`,undefined,{ifMatch:`"${version}"`}));},
    async reject(id,version,reason){return parseEnvelope(await client.post<unknown>(`/laboratory-reservations/${pathId(id)}/reject`,{reason},{ifMatch:`"${version}"`}));},
    async cancel(id,version,reason){return parseEnvelope(await client.post<unknown>(`/laboratory-reservations/${pathId(id)}/cancel`,{reason},{ifMatch:`"${version}"`}));},
  };
}
export const laboratoryReservationGateway=createLaboratoryReservationGateway(apiClient);
