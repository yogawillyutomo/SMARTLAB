import {describe,expect,it,vi} from 'vitest';
import type {ApiClient} from '@/lib/apiClient';
import {createPriorityEventGateway,parsePriorityEvent,PriorityEventContractError} from '@/services/priorityEventApi';

const ids={
 event:'01ARZ3NDEKTSV4RRFFQ69G5FAV',
 school:'01ARZ3NDEKTSV4RRFFQ69G5FAW',
 lab:'01ARZ3NDEKTSV4RRFFQ69G5FAX',
 user:'01ARZ3NDEKTSV4RRFFQ69G5FAY',
 membership:'01ARZ3NDEKTSV4RRFFQ69G5FAZ',
};

const event={
 id:ids.event,schoolId:ids.school,eventNumber:'PEV-20260914-ABC12345',
 laboratory:{id:ids.lab,code:'LAB-RPL-1',name:'Lab RPL 1',capacity:36,status:'active' as const},
 requester:{userId:ids.user,membershipId:ids.membership,name:'Guru A',email:'guru@example.test'},
 date:'2026-09-14',startsAt:'09:00:00',endsAt:'10:00:00',category:'official_visit' as const,
 title:'Kunjungan Mitra',participants:25,description:'Kegiatan prioritas',picName:'Waka Humas',
 status:'submitted' as const,rejectionReason:null,version:1,decidedAt:null,cancelledAt:null,
 createdAt:'2026-09-05T01:00:00.000Z',updatedAt:'2026-09-05T01:00:00.000Z',
 timeline:[{eventType:'priority_event.submitted' as const,actorName:'Guru A',at:'2026-09-05T01:00:00.000Z',payload:{},versionBefore:0,versionAfter:1}],
};

function client(post:ApiClient['post'],get:ApiClient['get']=vi.fn() as ApiClient['get']):ApiClient{
 return{ensureCsrfCookie:vi.fn(async()=>undefined),get,post,put:vi.fn() as ApiClient['put'],patch:vi.fn() as ApiClient['patch'],delete:vi.fn() as ApiClient['delete']};
}

describe('priority event API contract',()=>{
 it('parses canonical event and rejects malformed shapes',()=>{
   expect(parsePriorityEvent(event)).toEqual(event);
   expect(()=>parsePriorityEvent({...event,status:'pending'})).toThrow(PriorityEventContractError);
   expect(()=>parsePriorityEvent({...event,participants:0})).toThrow(PriorityEventContractError);
   expect(()=>parsePriorityEvent({...event,startsAt:'10:00:00',endsAt:'09:00:00'})).toThrow(PriorityEventContractError);
 });

 it('uses exact mutation endpoints and If-Match versions',async()=>{
   const post=vi.fn(async()=>({data:event})) as ApiClient['post'];
   const gateway=createPriorityEventGateway(client(post));

   await gateway.create({
     laboratoryId:ids.lab,date:'2026-09-14',startsAt:'09:00',endsAt:'10:00',
     category:'official_visit',title:'Kunjungan Mitra',participants:25,description:'Kegiatan prioritas',picName:'Waka Humas',
   });
   await gateway.approve(ids.event,1);
   await gateway.reject(ids.event,1,' Tidak sesuai ');
   await gateway.cancel(ids.event,1,' Dipindah ');

   expect(post).toHaveBeenNthCalledWith(1,'/priority-events',{
     laboratoryId:ids.lab,date:'2026-09-14',startsAt:'09:00',endsAt:'10:00',
     category:'official_visit',title:'Kunjungan Mitra',participants:25,description:'Kegiatan prioritas',picName:'Waka Humas',
   });
   expect(post).toHaveBeenNthCalledWith(2,`/priority-events/${ids.event}/approve`,undefined,{ifMatch:'"1"'});
   expect(post).toHaveBeenNthCalledWith(3,`/priority-events/${ids.event}/reject`,{reason:'Tidak sesuai'},{ifMatch:'"1"'});
   expect(post).toHaveBeenNthCalledWith(4,`/priority-events/${ids.event}/cancel`,{reason:'Dipindah'},{ifMatch:'"1"'});
 });
});
