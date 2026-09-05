import {describe,expect,it,vi} from 'vitest';
import type {ApiClient} from '@/lib/apiClient';
import {createLaboratoryReservationGateway,LaboratoryReservationContractError,parseLaboratoryReservation} from '@/services/laboratoryReservationApi';

const ids={reservation:'01ARZ3NDEKTSV4RRFFQ69G5FAV',school:'01ARZ3NDEKTSV4RRFFQ69G5FAW',lab:'01ARZ3NDEKTSV4RRFFQ69G5FAX',user:'01ARZ3NDEKTSV4RRFFQ69G5FAY',membership:'01ARZ3NDEKTSV4RRFFQ69G5FAZ'};
const reservation={
 id:ids.reservation,schoolId:ids.school,reservationNumber:'RSV-20260914-Q69G5FAV',
 laboratory:{id:ids.lab,code:'LAB-RPL-1',name:'Lab RPL 1',capacity:36,status:'active' as const},
 requester:{userId:ids.user,membershipId:ids.membership,name:'Guru A',email:'guru@example.test'},
 date:'2026-09-14',startsAt:'10:00:00',endsAt:'12:00:00',activity:'Praktikum tambahan',participants:30,
 deviceNeeds:'PC',notes:null,picName:'Guru A',status:'submitted' as const,rejectionReason:null,version:1,decidedAt:null,cancelledAt:null,
 createdAt:'2026-09-05T00:00:00.000Z',updatedAt:'2026-09-05T00:00:00.000Z',
 timeline:[{eventType:'reservation.submitted' as const,actorName:'Guru A',at:'2026-09-05T00:00:00.000Z',payload:{},versionBefore:0,versionAfter:1}],
};
function client(overrides:Partial<ApiClient>={}):ApiClient{return{ensureCsrfCookie:vi.fn(async()=>undefined),get:vi.fn() as ApiClient['get'],post:vi.fn() as ApiClient['post'],put:vi.fn() as ApiClient['put'],patch:vi.fn() as ApiClient['patch'],delete:vi.fn() as ApiClient['delete'],...overrides};}

describe('laboratory reservation API contract',()=>{
 it('parses canonical reservation and rejects malformed time/status',()=>{
   expect(parseLaboratoryReservation(reservation)).toEqual(reservation);
   expect(()=>parseLaboratoryReservation({...reservation,startsAt:'12:00:00',endsAt:'10:00:00'})).toThrow(LaboratoryReservationContractError);
   expect(()=>parseLaboratoryReservation({...reservation,status:'pending'})).toThrow(LaboratoryReservationContractError);
 });
 it('uses exact canonical endpoints and If-Match transitions',async()=>{
   const get=vi.fn(async()=>({data:[reservation],meta:{page:1,perPage:500,total:1,lastPage:1,from:'2026-09-01',to:'2026-09-30'}})) as ApiClient['get'];
   const post=vi.fn(async()=>({data:reservation})) as ApiClient['post'];
   const gateway=createLaboratoryReservationGateway(client({get,post}));
   await gateway.listAll({from:'2026-09-01',to:'2026-09-30',scope:'mine'});
   await gateway.create({laboratoryId:ids.lab,date:'2026-09-14',startsAt:'10:00',endsAt:'12:00',activity:'Praktikum',participants:30,picName:'Guru A'});
   await gateway.approve(ids.reservation,1);
   await gateway.reject(ids.reservation,2,'Tidak sesuai');
   await gateway.cancel(ids.reservation,3,'Dibatalkan');
   expect(get).toHaveBeenCalledWith('/laboratory-reservations?from=2026-09-01&to=2026-09-30&scope=mine&page=1&perPage=500');
   expect(post).toHaveBeenCalledWith(`/laboratory-reservations/${ids.reservation}/approve`,undefined,{ifMatch:'"1"'});
   expect(post).toHaveBeenCalledWith(`/laboratory-reservations/${ids.reservation}/reject`,{reason:'Tidak sesuai'},{ifMatch:'"2"'});
   expect(post).toHaveBeenCalledWith(`/laboratory-reservations/${ids.reservation}/cancel`,{reason:'Dibatalkan'},{ifMatch:'"3"'});
 });
});
