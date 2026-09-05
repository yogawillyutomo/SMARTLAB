import { apiClient, type ApiClient } from '@/lib/apiClient';
import { isUlid } from '@/lib/ulid';

export type AvailabilityState = 'available' | 'scheduled' | 'blocked' | 'mixed' | 'unknown';
export type AvailabilityBlockerType = 'schedule_occurrence' | 'schedule_exception' | 'calendar_event' | 'laboratory_status' | 'reservation' | 'priority_event' | 'laboratory_session';
export type ScheduleCoverageStatus = 'covered' | 'missing' | 'ambiguous';

export interface AvailabilityReferenceDto { id:string; code:string; name:string }
export interface AvailabilityBlockerDto {
  type: AvailabilityBlockerType;
  sourceId: string;
  title: string;
  allDay: boolean;
  startsAt: string | null;
  endsAt: string | null;
  details: Record<string, unknown>;
}
export interface AvailabilityNoticeDto {
  sourceId:string;
  title:string;
  allDay:boolean;
  startsAt:string|null;
  endsAt:string|null;
  details:{category:string;scope:'school'|'laboratory'};
}
export interface LaboratoryAvailabilityDto {
  laboratory:{id:string;code:string;name:string;status:'active'|'inactive'};
  window:{date:string;startsAt:string;endsAt:string};
  available:boolean;
  state:AvailabilityState;
  blockerCount:number;
  blockers:AvailabilityBlockerDto[];
  noticeCount:number;
  notices:AvailabilityNoticeDto[];
  sourceCoverage:{
    schedule:{status:ScheduleCoverageStatus;activePublicationCount:number};
    scheduleExceptions:{status:'covered'};
    operationalCalendar:{status:'covered'};
    reservations:{status:'covered'};
    priorityEvents:{status:'covered'};
    laboratorySessions:{status:'covered'};
    laboratoryStatus:{status:'covered'};
  };
  issues:{code:'schedule_coverage_missing'|'schedule_coverage_ambiguous';message:string}[];
}
export interface LaboratoryAvailabilityInput { laboratoryId:string; date:string; startsAt:string; endsAt:string }
export interface LaboratoryAvailabilityGateway { check:(input:LaboratoryAvailabilityInput)=>Promise<LaboratoryAvailabilityDto> }

export class LaboratoryAvailabilityContractError extends Error {
  constructor(message='Respons ketersediaan laboratorium tidak sesuai kontrak API.'){super(message);this.name='LaboratoryAvailabilityContractError';}
}
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
const INPUT_TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;
function record(v:unknown):v is Record<string,unknown>{return typeof v==='object'&&v!==null&&!Array.isArray(v);}
function integer(v:unknown):v is number{return Number.isSafeInteger(v)&&(v as number)>=0;}
function parseEvidence(v:unknown):AvailabilityBlockerDto{
  if(!record(v)||!['schedule_occurrence','schedule_exception','calendar_event','laboratory_status','reservation','priority_event','laboratory_session'].includes(String(v.type)))throw new LaboratoryAvailabilityContractError();
  if(typeof v.sourceId!=='string'||v.sourceId.trim()===''||typeof v.title!=='string'||typeof v.allDay!=='boolean'||!record(v.details))throw new LaboratoryAvailabilityContractError();
  if(v.startsAt!==null&&(typeof v.startsAt!=='string'||!TIME.test(v.startsAt)))throw new LaboratoryAvailabilityContractError();
  if(v.endsAt!==null&&(typeof v.endsAt!=='string'||!TIME.test(v.endsAt)))throw new LaboratoryAvailabilityContractError();
  return v as unknown as AvailabilityBlockerDto;
}
export function parseLaboratoryAvailability(value:unknown):LaboratoryAvailabilityDto{
  if(!record(value)||!record(value.data))throw new LaboratoryAvailabilityContractError();
  const d=value.data;
  if(!record(d.laboratory)||!isUlid(String(d.laboratory.id))||typeof d.laboratory.code!=='string'||typeof d.laboratory.name!=='string'||!['active','inactive'].includes(String(d.laboratory.status)))throw new LaboratoryAvailabilityContractError();
  if(!record(d.window)||typeof d.window.date!=='string'||!DATE.test(d.window.date)||typeof d.window.startsAt!=='string'||!TIME.test(d.window.startsAt)||typeof d.window.endsAt!=='string'||!TIME.test(d.window.endsAt)||d.window.startsAt>=d.window.endsAt)throw new LaboratoryAvailabilityContractError();
  if(typeof d.available!=='boolean'||!['available','scheduled','blocked','mixed','unknown'].includes(String(d.state))||!integer(d.blockerCount)||!integer(d.noticeCount)||!Array.isArray(d.blockers)||!Array.isArray(d.notices)||!Array.isArray(d.issues)||!record(d.sourceCoverage))throw new LaboratoryAvailabilityContractError();
  const blockers=d.blockers.map(parseEvidence);
  const notices=d.notices.map((n)=>{
    if(!record(n)||typeof n.sourceId!=='string'||typeof n.title!=='string'||typeof n.allDay!=='boolean'||!record(n.details)||typeof n.details.category!=='string'||!['school','laboratory'].includes(String(n.details.scope)))throw new LaboratoryAvailabilityContractError();
    if(n.startsAt!==null&&(typeof n.startsAt!=='string'||!TIME.test(n.startsAt)))throw new LaboratoryAvailabilityContractError();
    if(n.endsAt!==null&&(typeof n.endsAt!=='string'||!TIME.test(n.endsAt)))throw new LaboratoryAvailabilityContractError();
    return n as unknown as AvailabilityNoticeDto;
  });
  if(blockers.length!==d.blockerCount||notices.length!==d.noticeCount)throw new LaboratoryAvailabilityContractError();
  const schedule=(d.sourceCoverage as Record<string,unknown>).schedule;
  const exceptions=(d.sourceCoverage as Record<string,unknown>).scheduleExceptions;
  const calendar=(d.sourceCoverage as Record<string,unknown>).operationalCalendar;
  const reservations=(d.sourceCoverage as Record<string,unknown>).reservations;
  const priorityEvents=(d.sourceCoverage as Record<string,unknown>).priorityEvents;
  const laboratorySessions=(d.sourceCoverage as Record<string,unknown>).laboratorySessions;
  const labStatus=(d.sourceCoverage as Record<string,unknown>).laboratoryStatus;
  if(!record(schedule)||!['covered','missing','ambiguous'].includes(String(schedule.status))||!integer(schedule.activePublicationCount)||!record(exceptions)||exceptions.status!=='covered'||!record(calendar)||calendar.status!=='covered'||!record(reservations)||reservations.status!=='covered'||!record(priorityEvents)||priorityEvents.status!=='covered'||!record(laboratorySessions)||laboratorySessions.status!=='covered'||!record(labStatus)||labStatus.status!=='covered')throw new LaboratoryAvailabilityContractError();
  if(d.available!==(d.state==='available'))throw new LaboratoryAvailabilityContractError();
  return d as unknown as LaboratoryAvailabilityDto;
}
export function buildLaboratoryAvailabilityPath(input:LaboratoryAvailabilityInput):string{
  if(!isUlid(input.laboratoryId)||!DATE.test(input.date)||!INPUT_TIME.test(input.startsAt)||!INPUT_TIME.test(input.endsAt)||input.startsAt>=input.endsAt)throw new LaboratoryAvailabilityContractError('Window ketersediaan tidak valid.');
  return `/laboratory-availability?${new URLSearchParams({laboratoryId:input.laboratoryId,date:input.date,startsAt:input.startsAt,endsAt:input.endsAt}).toString()}`;
}
export function createLaboratoryAvailabilityGateway(client:ApiClient):LaboratoryAvailabilityGateway{
  return {async check(input){return parseLaboratoryAvailability(await client.get<unknown>(buildLaboratoryAvailabilityPath(input)));}};
}
export const laboratoryAvailabilityGateway=createLaboratoryAvailabilityGateway(apiClient);
