import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type CalendarScope = 'school' | 'laboratory';
export type CalendarAvailabilityEffect = 'informational' | 'blocked';
export type CalendarEventStatus = 'active' | 'cancelled';
export type CalendarCategory =
  | 'effective_day' | 'holiday' | 'exam' | 'school_event' | 'maintenance'
  | 'laboratory_closure' | 'school_closure' | 'workshop' | 'competition' | 'meeting' | 'other';

export interface CalendarLaboratoryRef { id: string; code: string; name: string }
export interface CalendarEventDto {
  id: string; schoolId: string; scope: CalendarScope; laboratory: CalendarLaboratoryRef | null;
  category: CalendarCategory; availabilityEffect: CalendarAvailabilityEffect; title: string; description: string | null;
  startsOn: string; endsOn: string; allDay: boolean; startsAt: string | null; endsAt: string | null;
  status: CalendarEventStatus; version: number; cancelledAt: string | null; createdAt: string; updatedAt: string;
}
export interface CalendarEventInput {
  scope: CalendarScope; laboratoryId: string | null; category: CalendarCategory;
  availabilityEffect: CalendarAvailabilityEffect; title: string; description?: string | null;
  startsOn: string; endsOn: string; allDay: boolean; startsAt?: string | null; endsAt?: string | null;
}
export type CalendarEventUpdate = Partial<CalendarEventInput>;
export interface CalendarEventPage { data: CalendarEventDto[]; meta: { page:number; perPage:number; total:number; lastPage:number } }
export interface CalendarEventGateway {
  list(filters:{from:string;to:string;status?:CalendarEventStatus}):Promise<CalendarEventDto[]>;
  create(input:CalendarEventInput):Promise<CalendarEventDto>;
  update(id:string,version:number,input:CalendarEventUpdate):Promise<CalendarEventDto>;
  cancel(id:string,version:number):Promise<CalendarEventDto>;
}

export class CalendarContractError extends Error {
  constructor(message='Respons kalender tidak sesuai kontrak API.') { super(message); this.name='CalendarContractError'; }
}

const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CATEGORIES:CalendarCategory[]=['effective_day','holiday','exam','school_event','maintenance','laboratory_closure','school_closure','workshop','competition','meeting','other'];
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function str(v:unknown):v is string{return typeof v==='string';}
function date(v:unknown):v is string{return str(v)&&DATE.test(v);}
function parseLab(v:unknown):CalendarLaboratoryRef|null{
  if(v===null)return null;
  if(!record(v)||!str(v.id)||!isUlid(v.id)||!str(v.code)||!str(v.name))throw new CalendarContractError();
  return {id:v.id,code:v.code,name:v.name};
}
export function parseCalendarEvent(v:unknown):CalendarEventDto{
  if(!record(v))throw new CalendarContractError();
  if(!str(v.id)||!isUlid(v.id)||!str(v.schoolId)||!isUlid(v.schoolId))throw new CalendarContractError();
  if(v.scope!=='school'&&v.scope!=='laboratory')throw new CalendarContractError();
  if(!CATEGORIES.includes(v.category as CalendarCategory))throw new CalendarContractError();
  if(v.availabilityEffect!=='informational'&&v.availabilityEffect!=='blocked')throw new CalendarContractError();
  if(!str(v.title)||v.title.trim()===''||!date(v.startsOn)||!date(v.endsOn)||v.startsOn>v.endsOn)throw new CalendarContractError();
  if(typeof v.allDay!=='boolean'||(v.status!=='active'&&v.status!=='cancelled')||!Number.isSafeInteger(v.version)||(v.version as number)<1)throw new CalendarContractError();
  const lab=parseLab(v.laboratory);
  if((v.scope==='school'&&lab!==null)||(v.scope==='laboratory'&&lab===null))throw new CalendarContractError();
  const startsAt=v.startsAt, endsAt=v.endsAt;
  if(v.allDay){
    if(startsAt!==null||endsAt!==null)throw new CalendarContractError();
  }else{
    if(!str(startsAt)||!str(endsAt)||startsAt>=endsAt||v.startsOn!==v.endsOn)throw new CalendarContractError();
  }
  if(v.description!==null&&!str(v.description))throw new CalendarContractError();
  if(v.cancelledAt!==null&&(!str(v.cancelledAt)||Number.isNaN(Date.parse(v.cancelledAt))))throw new CalendarContractError();
  if(!str(v.createdAt)||Number.isNaN(Date.parse(v.createdAt))||!str(v.updatedAt)||Number.isNaN(Date.parse(v.updatedAt)))throw new CalendarContractError();
  return {
    id:v.id,schoolId:v.schoolId,scope:v.scope,laboratory:lab,category:v.category as CalendarCategory,
    availabilityEffect:v.availabilityEffect,title:v.title,description:v.description as string|null,
    startsOn:v.startsOn,endsOn:v.endsOn,allDay:v.allDay,startsAt:startsAt as string|null,endsAt:endsAt as string|null,
    status:v.status,version:v.version as number,cancelledAt:v.cancelledAt as string|null,createdAt:v.createdAt,updatedAt:v.updatedAt,
  };
}
function parseEnvelope(v:unknown):CalendarEventDto{
  if(!record(v)||!('data'in v))throw new CalendarContractError();
  return parseCalendarEvent(v.data);
}
function parsePage(v:unknown):CalendarEventPage{
  if(!record(v)||!Array.isArray(v.data)||!record(v.meta))throw new CalendarContractError();
  const {page,perPage,total,lastPage}=v.meta;
  if(!Number.isSafeInteger(page)||!Number.isSafeInteger(perPage)||!Number.isSafeInteger(total)||!Number.isSafeInteger(lastPage))throw new CalendarContractError();
  return {data:v.data.map(parseCalendarEvent),meta:{page:page as number,perPage:perPage as number,total:total as number,lastPage:lastPage as number}};
}
function pathId(id:string):string{if(!isUlid(id))throw new CalendarContractError('ID kalender tidak valid.');return encodeURIComponent(id);}
export function createCalendarEventGateway(client:ApiClient):CalendarEventGateway{
  return {
    async list(filters){
      const qs=new URLSearchParams({from:filters.from,to:filters.to,status:filters.status??'active',perPage:'500'});
      const page=parsePage(await client.get<unknown>(`/calendar-events?${qs.toString()}`));
      if(page.meta.lastPage!==1)throw new CalendarContractError('Rentang kalender terlalu besar untuk satu tampilan.');
      return page.data;
    },
    async create(input){return parseEnvelope(await client.post<unknown>('/calendar-events',input));},
    async update(id,version,input){return parseEnvelope(await client.patch<unknown>(`/calendar-events/${pathId(id)}`,input,{ifMatch:`"${version}"`}));},
    async cancel(id,version){return parseEnvelope(await client.post<unknown>(`/calendar-events/${pathId(id)}/cancel`,undefined,{ifMatch:`"${version}"`}));},
  };
}
export const calendarEventGateway=createCalendarEventGateway(apiClient);
