-- The yellow lamp, local to the country the player is in (owner, 12 Nov 2026: "The jinee lamp not the purple the yellow
-- one, can be local, meaning country based local"). Its Detours told Lagos stories everywhere (a danfo's roof, a rich
-- madam) and a quarter of their questions were Nigeria questions, in India or Egypt too. Now the server knows the
-- player's country (the game already works it out as they move, /api/world/country, and tells it so: note_country);
-- a Detour is told as that country would (Nigeria keeps its own), and outside Nigeria the Nigeria questions become
-- questions about the country they're in (its capital, its money, its cities: country_facts).
set lock_timeout = '8s';

alter table public.player_positions add column if not exists country text check (country ~ '^[A-Z]{2}$');
alter table public.detours add column if not exists country text;

-- The player's country, as their game found it (only its flavour depends on it: the Detours' stories and questions).
create or replace function public.note_country(p_code text)
returns void
language sql
security definer
set search_path to ''
as $$
  update public.player_positions set country = upper(p_code)
   where user_id = auth.uid() and p_code ~* '^[A-Z]{2}$' and country is distinct from upper(p_code);
$$;
revoke execute on function public.note_country(text) from public, anon;
grant execute on function public.note_country(text) to authenticated, service_role;

-- What everyone knows of a country: its capital, its money and some of its cities.
create table public.country_facts (
  code text primary key,
  name text not null,
  capital text not null,
  currency text not null,
  cities text[] not null
);
alter table public.country_facts enable row level security; -- read by the game's functions only

insert into public.country_facts (code, name, capital, currency, cities) values
  ('NG', 'Nigeria', 'Abuja', 'Naira', array['Lagos', 'Kano', 'Ibadan', 'Port Harcourt']),
  ('GH', 'Ghana', 'Accra', 'Ghanaian cedi', array['Kumasi', 'Tamale', 'Takoradi', 'Cape Coast']),
  ('KE', 'Kenya', 'Nairobi', 'Kenyan shilling', array['Mombasa', 'Kisumu', 'Nakuru', 'Eldoret']),
  ('TZ', 'Tanzania', 'Dodoma', 'Tanzanian shilling', array['Dar es Salaam', 'Arusha', 'Mwanza']),
  ('UG', 'Uganda', 'Kampala', 'Ugandan shilling', array['Entebbe', 'Gulu', 'Jinja', 'Mbarara']),
  ('RW', 'Rwanda', 'Kigali', 'Rwandan franc', array['Huye', 'Rubavu', 'Musanze']),
  ('ET', 'Ethiopia', 'Addis Ababa', 'Ethiopian birr', array['Dire Dawa', 'Gondar', 'Bahir Dar', 'Mekelle']),
  ('ZA', 'South Africa', 'Pretoria', 'South African rand', array['Johannesburg', 'Cape Town', 'Durban']),
  ('EG', 'Egypt', 'Cairo', 'Egyptian pound', array['Alexandria', 'Giza', 'Luxor', 'Aswan']),
  ('MA', 'Morocco', 'Rabat', 'Moroccan dirham', array['Casablanca', 'Marrakesh', 'Fez', 'Tangier']),
  ('DZ', 'Algeria', 'Algiers', 'Algerian dinar', array['Oran', 'Constantine', 'Annaba']),
  ('TN', 'Tunisia', 'Tunis', 'Tunisian dinar', array['Sfax', 'Sousse', 'Kairouan']),
  ('SN', 'Senegal', 'Dakar', 'West African CFA franc', array['Touba', 'Thiès', 'Saint-Louis']),
  ('CI', 'Ivory Coast', 'Yamoussoukro', 'West African CFA franc', array['Abidjan', 'Bouaké', 'San-Pédro']),
  ('CM', 'Cameroon', 'Yaoundé', 'Central African CFA franc', array['Douala', 'Garoua', 'Bamenda']),
  ('BJ', 'Benin', 'Porto-Novo', 'West African CFA franc', array['Cotonou', 'Parakou', 'Abomey']),
  ('TG', 'Togo', 'Lomé', 'West African CFA franc', array['Sokodé', 'Kara', 'Kpalimé']),
  ('ZM', 'Zambia', 'Lusaka', 'Zambian kwacha', array['Kitwe', 'Ndola', 'Livingstone']),
  ('BW', 'Botswana', 'Gaborone', 'Botswana pula', array['Francistown', 'Maun', 'Kasane']),
  ('NA', 'Namibia', 'Windhoek', 'Namibian dollar', array['Walvis Bay', 'Swakopmund', 'Rundu']),
  ('AO', 'Angola', 'Luanda', 'Angolan kwanza', array['Huambo', 'Lobito', 'Benguela']),
  ('MZ', 'Mozambique', 'Maputo', 'Mozambican metical', array['Beira', 'Nampula', 'Quelimane']),
  ('CD', 'DR Congo', 'Kinshasa', 'Congolese franc', array['Lubumbashi', 'Goma', 'Kisangani']),
  ('US', 'the United States', 'Washington, D.C.', 'US dollar', array['New York', 'Los Angeles', 'Chicago', 'Houston']),
  ('CA', 'Canada', 'Ottawa', 'Canadian dollar', array['Toronto', 'Montreal', 'Vancouver', 'Calgary']),
  ('MX', 'Mexico', 'Mexico City', 'Mexican peso', array['Guadalajara', 'Monterrey', 'Cancún', 'Puebla']),
  ('CU', 'Cuba', 'Havana', 'Cuban peso', array['Santiago de Cuba', 'Camagüey', 'Holguín']),
  ('JM', 'Jamaica', 'Kingston', 'Jamaican dollar', array['Montego Bay', 'Spanish Town', 'Ocho Rios']),
  ('BR', 'Brazil', 'Brasília', 'Brazilian real', array['São Paulo', 'Rio de Janeiro', 'Salvador', 'Fortaleza']),
  ('AR', 'Argentina', 'Buenos Aires', 'Argentine peso', array['Córdoba', 'Rosario', 'Mendoza']),
  ('CL', 'Chile', 'Santiago', 'Chilean peso', array['Valparaíso', 'Concepción', 'Antofagasta']),
  ('CO', 'Colombia', 'Bogotá', 'Colombian peso', array['Medellín', 'Cali', 'Cartagena']),
  ('PE', 'Peru', 'Lima', 'Peruvian sol', array['Cusco', 'Arequipa', 'Trujillo']),
  ('GB', 'the United Kingdom', 'London', 'Pound sterling', array['Manchester', 'Birmingham', 'Glasgow', 'Liverpool']),
  ('IE', 'Ireland', 'Dublin', 'Euro', array['Cork', 'Galway', 'Limerick']),
  ('FR', 'France', 'Paris', 'Euro', array['Marseille', 'Lyon', 'Toulouse', 'Nice']),
  ('DE', 'Germany', 'Berlin', 'Euro', array['Hamburg', 'Munich', 'Cologne', 'Frankfurt']),
  ('ES', 'Spain', 'Madrid', 'Euro', array['Barcelona', 'Valencia', 'Seville', 'Bilbao']),
  ('PT', 'Portugal', 'Lisbon', 'Euro', array['Porto', 'Braga', 'Coimbra', 'Faro']),
  ('IT', 'Italy', 'Rome', 'Euro', array['Milan', 'Naples', 'Turin', 'Florence']),
  ('NL', 'the Netherlands', 'Amsterdam', 'Euro', array['Rotterdam', 'Utrecht', 'Eindhoven']),
  ('BE', 'Belgium', 'Brussels', 'Euro', array['Antwerp', 'Ghent', 'Bruges', 'Liège']),
  ('CH', 'Switzerland', 'Bern', 'Swiss franc', array['Zurich', 'Geneva', 'Basel', 'Lausanne']),
  ('AT', 'Austria', 'Vienna', 'Euro', array['Graz', 'Salzburg', 'Innsbruck']),
  ('SE', 'Sweden', 'Stockholm', 'Swedish krona', array['Gothenburg', 'Malmö', 'Uppsala']),
  ('NO', 'Norway', 'Oslo', 'Norwegian krone', array['Bergen', 'Trondheim', 'Stavanger']),
  ('DK', 'Denmark', 'Copenhagen', 'Danish krone', array['Aarhus', 'Odense', 'Aalborg']),
  ('FI', 'Finland', 'Helsinki', 'Euro', array['Tampere', 'Turku', 'Oulu']),
  ('IS', 'Iceland', 'Reykjavík', 'Icelandic króna', array['Akureyri', 'Kópavogur', 'Hafnarfjörður']),
  ('PL', 'Poland', 'Warsaw', 'Polish złoty', array['Kraków', 'Gdańsk', 'Wrocław', 'Poznań']),
  ('CZ', 'Czechia', 'Prague', 'Czech koruna', array['Brno', 'Ostrava', 'Plzeň']),
  ('HU', 'Hungary', 'Budapest', 'Hungarian forint', array['Debrecen', 'Szeged', 'Pécs']),
  ('RO', 'Romania', 'Bucharest', 'Romanian leu', array['Cluj-Napoca', 'Iași', 'Timișoara']),
  ('HR', 'Croatia', 'Zagreb', 'Euro', array['Split', 'Dubrovnik', 'Rijeka']),
  ('GR', 'Greece', 'Athens', 'Euro', array['Thessaloniki', 'Patras', 'Heraklion']),
  ('TR', 'Turkey', 'Ankara', 'Turkish lira', array['Istanbul', 'Izmir', 'Antalya', 'Bursa']),
  ('UA', 'Ukraine', 'Kyiv', 'Ukrainian hryvnia', array['Kharkiv', 'Odesa', 'Lviv']),
  ('RU', 'Russia', 'Moscow', 'Russian ruble', array['Saint Petersburg', 'Novosibirsk', 'Kazan']),
  ('SA', 'Saudi Arabia', 'Riyadh', 'Saudi riyal', array['Jeddah', 'Mecca', 'Medina', 'Dammam']),
  ('AE', 'the United Arab Emirates', 'Abu Dhabi', 'UAE dirham', array['Dubai', 'Sharjah', 'Al Ain']),
  ('QA', 'Qatar', 'Doha', 'Qatari riyal', array['Al Wakrah', 'Al Khor', 'Lusail']),
  ('JO', 'Jordan', 'Amman', 'Jordanian dinar', array['Zarqa', 'Irbid', 'Aqaba']),
  ('LB', 'Lebanon', 'Beirut', 'Lebanese pound', array['Sidon', 'Tyre', 'Byblos']),
  ('IR', 'Iran', 'Tehran', 'Iranian rial', array['Mashhad', 'Isfahan', 'Shiraz', 'Tabriz']),
  ('IN', 'India', 'New Delhi', 'Indian rupee', array['Mumbai', 'Bengaluru', 'Kolkata', 'Chennai', 'Agra']),
  ('PK', 'Pakistan', 'Islamabad', 'Pakistani rupee', array['Karachi', 'Lahore', 'Peshawar']),
  ('BD', 'Bangladesh', 'Dhaka', 'Bangladeshi taka', array['Chittagong', 'Khulna', 'Sylhet']),
  ('NP', 'Nepal', 'Kathmandu', 'Nepalese rupee', array['Pokhara', 'Lalitpur', 'Biratnagar']),
  ('CN', 'China', 'Beijing', 'Chinese yuan', array['Shanghai', 'Guangzhou', 'Shenzhen', 'Chengdu']),
  ('JP', 'Japan', 'Tokyo', 'Japanese yen', array['Osaka', 'Kyoto', 'Yokohama', 'Sapporo']),
  ('KR', 'South Korea', 'Seoul', 'South Korean won', array['Busan', 'Incheon', 'Daegu']),
  ('TH', 'Thailand', 'Bangkok', 'Thai baht', array['Chiang Mai', 'Phuket', 'Pattaya']),
  ('VN', 'Vietnam', 'Hanoi', 'Vietnamese dong', array['Ho Chi Minh City', 'Da Nang', 'Hai Phong']),
  ('KH', 'Cambodia', 'Phnom Penh', 'Cambodian riel', array['Siem Reap', 'Battambang', 'Sihanoukville']),
  ('MM', 'Myanmar', 'Naypyidaw', 'Myanmar kyat', array['Yangon', 'Mandalay', 'Bago']),
  ('MY', 'Malaysia', 'Kuala Lumpur', 'Malaysian ringgit', array['George Town', 'Johor Bahru', 'Ipoh']),
  ('ID', 'Indonesia', 'Jakarta', 'Indonesian rupiah', array['Surabaya', 'Bandung', 'Medan', 'Yogyakarta']),
  ('PH', 'the Philippines', 'Manila', 'Philippine peso', array['Quezon City', 'Cebu City', 'Davao City']),
  ('AU', 'Australia', 'Canberra', 'Australian dollar', array['Sydney', 'Melbourne', 'Brisbane', 'Perth']),
  ('NZ', 'New Zealand', 'Wellington', 'New Zealand dollar', array['Auckland', 'Christchurch', 'Queenstown']);

-- A question about the country the player is in: its capital, its money, or which city is in it (null: not one we know).
create or replace function public.country_question(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  f public.country_facts%rowtype;
  pick integer := 1 + floor(random() * 3)::integer;
begin
  select * into f from public.country_facts where code = upper(p_code);
  if f.code is null then
    return null;
  end if;
  if pick = 1 then
    return public.build_question(format('What is the capital of %s?', f.name), f.capital,
      array(select g.capital from public.country_facts g where g.code <> f.code order by random() limit 3));
  elsif pick = 2 then
    return public.build_question(format('Which money is used in %s?', f.name), f.currency,
      array(select c from (select distinct g.currency as c from public.country_facts g where g.currency <> f.currency) x order by random() limit 3));
  end if;
  return public.build_question(format('Which of these cities is in %s?', f.name), f.cities[1 + floor(random() * array_length(f.cities, 1))::integer],
    array(select c from public.country_facts g, unnest(g.cities) c where g.code <> f.code order by random() limit 3));
end;
$$;
revoke execute on function public.country_question(text) from public, anon, authenticated;
grant execute on function public.country_question(text) to service_role;

-- A Detour, told as the player's country would: Nigeria's own stories in Nigeria, plain ones elsewhere.
create or replace function public.spawn_detour(p_area text, p_lng double precision, p_lat double precision, p_country text)
returns void
language plpgsql
security definer
set search_path to ''
as $$
declare
  spot public.places%rowtype;
  roll double precision := random();
  pick integer;
  d_kind text;
  d_title text;
  d_story text;
  d_coins integer := 0;
  d_relic text;
  d_item text;
  d_qty integer := 0;
  d_prize text;
  d_capacity integer;
  d_minutes integer;
  naija boolean := coalesce(p_country, 'NG') = 'NG';
  common text[] := array['shield', 'second_wind', 'jerry_can', 'rain_charm', 'tyre_kit'];
  rare text[] := array['radar', 'fast_pass'];
  flash_titles text[] := case when naija
    then array['A merchant''s lost pouch', 'The fallen trinket', 'The tailor''s secret', 'A forgotten parcel']
    else array['A vendor''s lost pouch', 'The fallen trinket', 'The tailor''s secret', 'A forgotten parcel'] end;
  flash_stories text[] := case when naija then array[
    'A merchant''s mule kicked a pouch loose near %s. Street boys are already sniffing around: it won''t last.',
    'An old woman near %s swears something glowing fell off a danfo''s roof. Get there before the sweepers do.',
    'A tailor near %s sewed something strange into a coat hem and left it on the line. Quick, before the owner comes back.',
    'A dispatch rider dropped a parcel in a street near %s and rode off. Someone will pick it up soon.']
    else array[
    'A street vendor near %s dropped a pouch, and something in it glows. Others have seen it: it won''t last.',
    'An old man near %s swears something shiny fell off the back of a delivery van. Get there before the street sweepers do.',
    'A tailor near %s sewed something strange into a coat hem and left it on the line. Quick, before the owner comes back.',
    'A cyclist dropped a parcel in a street near %s and rode off. Someone will pick it up soon.'] end;
  rush_titles text[] := case when naija
    then array['Gold at the roadside', 'The drummer''s call', 'The generous madam']
    else array['Gold at the roadside', 'The busker''s call', 'The generous stranger'] end;
  rush_stories text[] := case when naija then array[
    'A courier''s bag split open near %s. The first %s hunters to get there share what fell out.',
    'A drummer in a street near %s will reward the first %s hunters who find him. After that, he packs up and goes.',
    'A rich madam near %s is celebrating, and the first %s hunters to greet her get a gift.']
    else array[
    'A courier''s bag split open near %s. The first %s hunters to get there share what fell out.',
    'A street musician near %s will reward the first %s hunters who find him. After that, he packs up and goes.',
    'A wealthy stranger near %s is celebrating, and the first %s hunters to greet her get a gift.'] end;
  flash_rush_titles text[] := array['The smugglers'' stash', 'The vanishing stall'];
  flash_rush_stories text[] := array[
    'Smugglers hid a stash near %s. The first %s hunters to crack its lock take a share, and the police are on their way.',
    'A stall near %s appears for only half an hour and serves only the first %s customers. Its goods are rare.'];
begin
  select * into spot from public.places
   where lat between p_lat - 0.04 and p_lat + 0.04 and lng between p_lng - 0.04 and p_lng + 0.04
     and public.distance_m(p_lng, p_lat, lng, lat) between 500 and 4000
   order by street_lng is null, random() limit 1;
  if spot.id is null then
    return;
  end if;

  if roll < 0.5 then
    d_kind := 'flash';
    d_minutes := 20 + floor(random() * 21)::integer;
    pick := 1 + floor(random() * array_length(flash_titles, 1))::integer;
    d_title := flash_titles[pick];
    d_story := format(flash_stories[pick], spot.name);
    if random() < 0.5 then d_coins := 30 + floor(random() * 51)::integer;
    else d_prize := common[1 + floor(random() * array_length(common, 1))::integer]; end if;
  elsif roll < 0.8 then
    d_kind := 'rush';
    d_minutes := 60;
    d_capacity := 5 + floor(random() * 16)::integer;
    pick := 1 + floor(random() * array_length(rush_titles, 1))::integer;
    d_title := rush_titles[pick];
    d_story := format(rush_stories[pick], spot.name, d_capacity);
    if random() < 0.45 then d_coins := 40 + floor(random() * 61)::integer;
    else d_prize := common[1 + floor(random() * array_length(common, 1))::integer]; end if;
  else
    d_kind := 'flash_rush';
    d_minutes := 30;
    d_capacity := 3 + floor(random() * 6)::integer;
    pick := 1 + floor(random() * array_length(flash_rush_titles, 1))::integer;
    d_title := flash_rush_titles[pick];
    d_story := format(flash_rush_stories[pick], spot.name, d_capacity);
    if random() < 0.6 then d_prize := rare[1 + floor(random() * array_length(rare, 1))::integer];
    else d_coins := 120 + floor(random() * 81)::integer; end if;
  end if;
  if d_prize = 'cruise' then
    d_item := 'cruise';
    d_qty := case d_kind when 'flash' then 2 when 'rush' then 3 else 4 end;
  elsif d_prize = 'tyre_kit' then
    d_item := 'tyre_kit';
    d_qty := 1;
  else
    d_relic := d_prize;
  end if;

  insert into public.detours (kind, area, title, story, place_name, lng, lat, reward_coins, reward_relic, reward_item, reward_qty, capacity, ends_at, country)
  values (d_kind, p_area, d_title, d_story, spot.name, coalesce(spot.street_lng, spot.lng), coalesce(spot.street_lat, spot.lat),
          d_coins, d_relic, d_item, d_qty, d_capacity, now() + make_interval(mins => d_minutes), p_country);
end;
$$;
revoke execute on function public.spawn_detour(text, double precision, double precision, text) from public, anon, authenticated;
grant execute on function public.spawn_detour(text, double precision, double precision, text) to service_role;

-- The lamp spawns the area's Detours in the player's country.
do $$
declare
  f text := pg_get_functiondef('public.lamp_state()'::regprocedure);
  a text := 'perform public.spawn_detour(my_area, pos.lng, pos.lat);';
begin
  if position(a in f) = 0 then
    raise exception 'lamp_state: spawn call not found';
  end if;
  execute replace(f, a, 'perform public.spawn_detour(my_area, pos.lng, pos.lat, pos.country);');
end $$;

-- A Detour's question: Nigeria questions in Nigeria; elsewhere, questions about the country the player is in.
create or replace function public.start_detour(p_detour uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  uid uuid := auth.uid();
  d public.detours%rowtype;
  pos public.player_positions%rowtype;
  q jsonb;
  cat text;
  claim public.detour_claims%rowtype;
begin
  if uid is null then
    raise exception 'Not signed in';
  end if;
  if public.racing_now(uid) then
    return jsonb_build_object('ok', false, 'reason', 'hunting');
  end if;
  select * into d from public.detours where id = p_detour;
  if d.id is null or d.ends_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'over');
  end if;
  if d.capacity is not null and d.claimed >= d.capacity then
    return jsonb_build_object('ok', false, 'reason', 'full');
  end if;
  select * into pos from public.player_positions where user_id = uid;
  if pos.user_id is null or public.distance_m(pos.lng, pos.lat, d.lng, d.lat) > 40 then
    return jsonb_build_object('ok', false, 'reason', 'far');
  end if;
  if exists (select 1 from public.detour_claims where detour_id = d.id and user_id = uid) then
    return jsonb_build_object('ok', false, 'reason', 'tried');
  end if;
  cat := (array['maths', 'sequences', 'general', 'local'])[1 + floor(random() * 4)::integer];
  if cat = 'local' then
    q := case when coalesce(pos.country, 'NG') = 'NG' then null else public.country_question(pos.country) end;
    cat := case when coalesce(pos.country, 'NG') = 'NG' then 'nigeria' else 'general' end; -- (a country we don't know: general)
  end if;
  if q is null then
    q := public.make_question(cat, 1 + floor(random() * 2)::integer) - 'bank_id';
  end if;
  insert into public.detour_claims (detour_id, user_id, question, deadline)
  values (d.id, uid, q, now() + interval '30 seconds')
  returning * into claim;
  return jsonb_build_object('ok', true, 'title', d.title, 'question', q ->> 'prompt', 'options', q -> 'choices',
    'seconds', 30, 'deadline', claim.deadline, 'now', now());
end;
$$;
