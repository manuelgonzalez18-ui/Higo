update public.higuerote_corridor_fares set aliases = array['el 100','sector el 100','el cien','sector el cien','el 100 tacarigua','100 tacarigua'], updated_at = now() where name = 'El 100';

update public.higuerote_corridor_fares set aliases = array['hospital central','hospital universitario general de higuerote','hospital general universitario de higuerote','hospital general de higuerote','hospital universitario de higuerote','hospital de higuerote','gran cacique higoroto','hospital gran cacique higoroto','hugh'], updated_at = now() where name = 'Hospital Central';

update public.higuerote_corridor_fares set aliases = array['hotel aguamarina','aguamarina','hotel agua marina','agua marina','aguamarina higuerote','hotel aguamarina higuerote'], updated_at = now() where name = 'Hotel Aguamarina';

notify pgrst, 'reload schema';
