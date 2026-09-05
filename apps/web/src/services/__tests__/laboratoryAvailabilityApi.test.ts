import {describe,expect,it,vi} from 'vitest';
import type {ApiClient} from '@/lib/apiClient';
import {buildLaboratoryAvailabilityPath,createLaboratoryAvailabilityGateway,LaboratoryAvailabilityContractError,parseLaboratoryAvailability} from '@/services/laboratoryAvailabilityApi';

const labId='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const payload={data:{
 laboratory:{id:labId,code:'LAB-RPL-1',name:'Lab RPL 1',status:'active'},
 window:{date:'2026-09-14',startsAt:'10:00:00',endsAt:'12:00:00'},
 available:false,state:'blocked',blockerCount:1,
 blockers:[{type:'calendar_event',sourceId:'01ARZ3NDEKTSV4RRFFQ69G5FAW',title:'Maintenance',allDay:false,startsAt:'10:00:00',endsAt:'12:00:00',details:{category:'maintenance',scope:'laboratory'}}],
 noticeCount:0,notices:[],
 sourceCoverage:{schedule:{status:'covered',activePublicationCount:1},operationalCalendar:{status:'covered'},reservations:{status:'covered'},laboratoryStatus:{status:'covered'}},
 issues:[]
}};

function client(get:ApiClient['get']):ApiClient{return{ensureCsrfCookie:vi.fn(async()=>undefined),get,post:vi.fn() as ApiClient['post'],put:vi.fn() as ApiClient['put'],patch:vi.fn() as ApiClient['patch'],delete:vi.fn() as ApiClient['delete']};}

describe('laboratory availability contract',()=>{
 it('parses explainable availability and rejects inconsistent boolean/state',()=>{
   expect(parseLaboratoryAvailability(payload)).toEqual(payload.data);
   expect(()=>parseLaboratoryAvailability({data:{...payload.data,available:true}})).toThrow(LaboratoryAvailabilityContractError);
   expect(()=>parseLaboratoryAvailability({data:{...payload.data,blockerCount:2}})).toThrow(LaboratoryAvailabilityContractError);
 });
 it('builds an exact single-window path and rejects unsafe input',()=>{
   expect(buildLaboratoryAvailabilityPath({laboratoryId:labId,date:'2026-09-14',startsAt:'10:00',endsAt:'12:00'}))
    .toBe(`/laboratory-availability?laboratoryId=${labId}&date=2026-09-14&startsAt=10%3A00&endsAt=12%3A00`);
   expect(()=>buildLaboratoryAvailabilityPath({laboratoryId:labId,date:'2026-09-14',startsAt:'12:00',endsAt:'10:00'})).toThrow(LaboratoryAvailabilityContractError);
 });
 it('reads only the canonical availability endpoint',async()=>{
   const get=vi.fn(async()=>payload) as ApiClient['get'];
   const gateway=createLaboratoryAvailabilityGateway(client(get));
   await expect(gateway.check({laboratoryId:labId,date:'2026-09-14',startsAt:'10:00',endsAt:'12:00'})).resolves.toEqual(payload.data);
   expect(get).toHaveBeenCalledTimes(1);
 });
});
