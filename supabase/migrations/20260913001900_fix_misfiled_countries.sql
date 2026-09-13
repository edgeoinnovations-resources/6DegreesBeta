-- ============================================================================
-- Move 119 schools out of the wrong countries.
--
-- Paul reported that South Korea had no schools. It did — 40 of them, filed under
-- KENYA. The ISR import recognised a country heading only if it matched a country
-- name exactly, and 16 real headings did not: "Korea", "Turkey", "Great Britain",
-- "Kurdistan", "Cayman Island", "Fiji Islands", "Cote D’Ivoire" and others. Every
-- school under an unrecognised heading was silently appended to the PREVIOUS
-- country alphabetically — Korean schools to Kenya, Turkish to Tunisia, British to
-- Ghana — and given that wrong country's largest city.
--
-- No member had a posting at any of them (checked before writing this), so no
-- member history changes.
--
--   * 113 schools move to their real country, with a city: placed by hand where the
--     location is known, read from the name where it appears, otherwise the largest
--     city flagged 'fallback-largest-city' so the app marks it as a guess.
--   * 6 are deleted: Kurdistan schools that ISR ALSO lists under Iraq, where they
--     were already filed correctly.
--   * International Christian School Seoul and Yongsan International School Seoul
--     are one school, renamed. Kept once, carrying both names so either is
--     searchable; two records would make colleagues there compute as degree 3.
--   * City fixes that change degrees: Tarabya and Üsküdar are part of Istanbul, not
--     separate cities.
-- ============================================================================

delete from public.schools where name = 'American International School' and country = 'Kenya';
delete from public.schools where name = 'British International Schools' and country = 'Kenya';
delete from public.schools where name = 'Ihsan Dogramaci Erbil College' and country = 'Kenya';
delete from public.schools where name = 'International Maarif Schools Erbil' and country = 'Kenya';
delete from public.schools where name = 'Ronaki International School Erbil' and country = 'Kenya';
delete from public.schools where name = 'Zakho British International School' and country = 'Kenya';
update public.schools set country = 'Cayman Islands', country_code = 'KY', city = 'George Town', latitude = 19.2866, longitude = -81.37436, city_source = 'fallback-largest-city' where name = 'Cayman International School' and country = 'Canada';
update public.schools set country = 'Cayman Islands', country_code = 'KY', city = 'George Town', latitude = 19.2866, longitude = -81.37436, city_source = 'fallback-largest-city' where name = 'Cayman Prep & High School' and country = 'Canada';
update public.schools set country = 'Cayman Islands', country_code = 'KY', city = 'George Town', latitude = 19.2866, longitude = -81.37436, city_source = 'fallback-largest-city' where name = 'St Ignatius Catholic School' and country = 'Canada';
update public.schools set country = 'Cayman Islands', country_code = 'KY', city = 'George Town', latitude = 19.2866, longitude = -81.37436, city_source = 'fallback-largest-city' where name = 'Triple C School' and country = 'Canada';
update public.schools set country = 'DR Congo', country_code = 'CD', city = 'Lubumbashi', latitude = -11.66089, longitude = 27.47938, city_source = 'name' where name = 'International School Lubumbashi' and country = 'Colombia';
update public.schools set country = 'DR Congo', country_code = 'CD', city = 'Kinshasa', latitude = -4.32758, longitude = 15.31357, city_source = 'name' where name = 'The American School of Kinshasa' and country = 'Colombia';
update public.schools set country = 'Congo', country_code = 'CG', city = 'Brazzaville', latitude = -4.26613, longitude = 15.28318, city_source = 'name' where name = 'American International School Brazzaville' and country = 'Colombia';
update public.schools set country = 'Congo', country_code = 'CG', city = 'Pointe-Noire', latitude = -4.77609, longitude = 11.86352, city_source = 'name' where name = 'International School Pointe-Noire' and country = 'Colombia';
update public.schools set country = 'Côte d''Ivoire', country_code = 'CI', city = 'Abidjan', latitude = 5.35444, longitude = -4.00167, city_source = 'name' where name = 'International Community School Abidjan' and country = 'Costa Rica';
update public.schools set country = 'Curaçao', country_code = 'CW', city = 'Willemstad', latitude = 12.12246, longitude = -68.88641, city_source = 'fallback-largest-city' where name = 'International School Curacao' and country = 'Cuba';
update public.schools set country = 'Fiji', country_code = 'FJ', city = 'Nadi', latitude = -17.80309, longitude = 177.41617, city_source = 'name' where name = 'International School Nadi' and country = 'Ethiopia';
update public.schools set country = 'Fiji', country_code = 'FJ', city = 'Suva', latitude = -18.13683, longitude = 178.42531, city_source = 'name' where name = 'International School Suva' and country = 'Ethiopia';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'Cobham', latitude = 51.32997, longitude = -0.4113, city_source = 'name' where name = 'ACS International Schools – Cobham' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'Egham', latitude = 51.43158, longitude = -0.55239, city_source = 'name' where name = 'ACS International School – Egham' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'ACS International Schools – Hillingdon' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'Ashwicke Hall School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'Boundary Oak School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'Cambridge', latitude = 52.2, longitude = 0.11667, city_source = 'name' where name = 'Cambridge International School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'name' where name = 'Halcyon London International School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'name' where name = 'International Community School London' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'Aberdeen', latitude = 57.14369, longitude = -2.09814, city_source = 'name' where name = 'International School of Aberdeen Scotland' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'name' where name = 'International School of London' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'name' where name = 'King Fahad Academy London England' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'Marymount International School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'name' where name = 'North London International School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'Padworth College Berkshire UK' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'Southbank International School' and country = 'Ghana';
update public.schools set country = 'United Kingdom', country_code = 'GB', city = 'London', latitude = 51.50853, longitude = -0.12574, city_source = 'fallback-largest-city' where name = 'TASIS The American School in England' and country = 'Ghana';
update public.schools set country = 'Guinea', country_code = 'GN', city = 'Conakry', latitude = 9.53795, longitude = -13.67729, city_source = 'name' where name = 'American International School Conakry' and country = 'Guatemala';
update public.schools set country = 'Guinea', country_code = 'GN', city = 'Conakry', latitude = 9.53795, longitude = -13.67729, city_source = 'fallback-largest-city' where name = 'English Speaking Community School' and country = 'Guatemala';
update public.schools set country = 'Guinea', country_code = 'GN', city = 'Conakry', latitude = 9.53795, longitude = -13.67729, city_source = 'name' where name = 'International School Conakry' and country = 'Guatemala';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Asia Pacific International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'BIS Canada' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seogwipo', latitude = 33.25333, longitude = 126.56181, city_source = 'manual' where name = 'Branksome Hall Asia' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Busan', latitude = 35.10168, longitude = 129.03004, city_source = 'manual' where name = 'Busan Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Canada International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Centennial Christian School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Incheon', latitude = 37.45646, longitude = 126.70515, city_source = 'manual' where name = 'Chadwick International' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Incheon', latitude = 37.45646, longitude = 126.70515, city_source = 'manual' where name = 'Cheongna Dalton School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Gapyeong', latitude = 37.83101, longitude = 127.51059, city_source = 'manual' where name = 'CheongShim International Academy' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Yeosu', latitude = 34.76062, longitude = 127.66215, city_source = 'manual' where name = 'Child U-Yeosu' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Daegu', latitude = 35.87028, longitude = 128.59111, city_source = 'manual' where name = 'Daegu International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Dwight School Seoul' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Iksan', latitude = 35.94389, longitude = 126.95444, city_source = 'manual' where name = 'ECC Ik-San' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Etonhouse Prep Seoul' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Global Prodigy Academy' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Global Vision Christian School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Gyeonggi Global School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Gyeonggi International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Suwon', latitude = 37.29111, longitude = 127.00889, city_source = 'manual' where name = 'Gyeonggi Suwon International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Gyeongnam International Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Pohang', latitude = 36.02917, longitude = 129.36481, city_source = 'manual' where name = 'Handong International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Ulsan', latitude = 35.53722, longitude = 129.31667, city_source = 'manual' where name = 'Hyundai Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Indianhead International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'International Christian School Seoul' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Pyeongtaek', latitude = 36.99472, longitude = 127.08889, city_source = 'manual' where name = 'International Christian School Pyeongtaek' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Busan', latitude = 35.10168, longitude = 129.03004, city_source = 'manual' where name = 'International School Busan' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Geoje', latitude = 34.81379, longitude = 128.70556, city_source = 'manual' where name = 'International School Koje' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Korea Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seongnam-si', latitude = 37.43861, longitude = 127.13778, city_source = 'manual' where name = 'Korea International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Korea Kent Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Gwangju', latitude = 35.15472, longitude = 126.91556, city_source = 'manual' where name = 'Kwangju Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'Namsan International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'fallback-largest-city' where name = 'New Zealand International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seogwipo', latitude = 33.25333, longitude = 126.56181, city_source = 'manual' where name = 'North London Collegiate School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Seoul Foreign School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seongnam-si', latitude = 37.43861, longitude = 127.13778, city_source = 'manual' where name = 'Seoul International School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seogwipo', latitude = 33.25333, longitude = 126.56181, city_source = 'manual' where name = 'St. Johnsbury Academy' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'St. Paul Preparatory School' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Daejeon', latitude = 36.34913, longitude = 127.38493, city_source = 'manual' where name = 'Taejon Christian International' and country = 'Kenya';
update public.schools set country = 'South Korea', country_code = 'KR', city = 'Seoul', latitude = 37.566, longitude = 126.9784, city_source = 'manual' where name = 'Yongsan International School Seoul' and country = 'Kenya';
update public.schools set country = 'Kosovo', country_code = 'XK', city = 'Pristina', latitude = 42.67272, longitude = 21.16688, city_source = 'fallback-largest-city' where name = 'American School of Kosova' and country = 'Kenya';
update public.schools set country = 'Kosovo', country_code = 'XK', city = 'Pristina', latitude = 42.67272, longitude = 21.16688, city_source = 'fallback-largest-city' where name = 'International Learning Group School Kosovo' and country = 'Kenya';
update public.schools set country = 'Kosovo', country_code = 'XK', city = 'Pristina', latitude = 42.67272, longitude = 21.16688, city_source = 'fallback-largest-city' where name = 'Prishtina High School' and country = 'Kenya';
update public.schools set country = 'Iraq', country_code = 'IQ', city = 'Erbil', latitude = 36.19117, longitude = 44.00943, city_source = 'name' where name = 'SABIS International School of Choueifat Erbil' and country = 'Kenya';
update public.schools set country = 'Sint Maarten', country_code = 'SX', city = 'Philipsburg', latitude = 18.026, longitude = -63.04582, city_source = 'fallback-largest-city' where name = 'Caribbean International Academy' and country = 'Rwanda';
update public.schools set country = 'Sint Maarten', country_code = 'SX', city = 'Philipsburg', latitude = 18.026, longitude = -63.04582, city_source = 'fallback-largest-city' where name = 'St. Maarten International School' and country = 'Rwanda';
update public.schools set country = 'Trinidad and Tobago', country_code = 'TT', city = 'Port of Spain', latitude = 10.66668, longitude = -61.51889, city_source = 'name' where name = 'International School of Port of Spain' and country = 'Togo';
update public.schools set country = 'Trinidad and Tobago', country_code = 'TT', city = 'Chaguanas', latitude = 10.51667, longitude = -61.41667, city_source = 'fallback-largest-city' where name = 'Maple Leaf International School Trinidad' and country = 'Togo';
update public.schools set country = 'Trinidad and Tobago', country_code = 'TT', city = 'Chaguanas', latitude = 10.51667, longitude = -61.41667, city_source = 'fallback-largest-city' where name = 'Trillium International of Trinidad &Tobago' and country = 'Togo';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'Aci Pre & Primary Schools Istanbul' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'İzmir', latitude = 38.41273, longitude = 27.13838, city_source = 'manual' where name = 'American Collegiate Institute' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Erzurum', latitude = 39.90861, longitude = 41.27694, city_source = 'name' where name = 'Bilkent Erzurum Laboratory School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Ankara', latitude = 39.91987, longitude = 32.85427, city_source = 'manual' where name = 'Bilkent Laboratory & International School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'British International School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Cakir Schools' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'Enka Okullari Istanbul' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Eyuboglu Schools K-12' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Final Okullari Cekmekoy' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Hisar School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'İzmir', latitude = 38.41273, longitude = 27.13838, city_source = 'name' where name = 'Isikkent School Izmir' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'Istanbul International Community School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'ISTEK Foundation' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Keystone International School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'Kok School Istanbul' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'MEF International School Istanbul' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'İzmir', latitude = 38.41273, longitude = 27.13838, city_source = 'name' where name = 'MEF International School Izmir' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Nesibe Aydin' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Gaziantep', latitude = 37.05944, longitude = 37.3825, city_source = 'name' where name = 'Private Sanko Schools Gaziantep' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'Robert College Istanbul' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'SEV American College' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'İzmir', latitude = 38.41273, longitude = 27.13838, city_source = 'name' where name = 'SEV Izmir' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'manual' where name = 'Tarabya British Schools' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Tarsus', latitude = 36.91766, longitude = 34.89277, city_source = 'name' where name = 'Tarsus American College' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Ankara', latitude = 39.91987, longitude = 32.85427, city_source = 'name' where name = 'TED Ankara College Foundation' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'name' where name = 'TED College Istanbul (TED Istanbul Koleji)' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'fallback-largest-city' where name = 'Tevitol High School' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Istanbul', latitude = 41.01384, longitude = 28.94966, city_source = 'manual' where name = 'Uskudar American Acad. & SEV Elementary' and country = 'Tunisia';
update public.schools set country = 'Turkey', country_code = 'TR', city = 'Gaziantep', latitude = 37.05944, longitude = 37.3825, city_source = 'manual' where name = 'Zirve University' and country = 'Tunisia';
update public.schools set country = 'US Virgin Islands', country_code = 'VI', city = 'Saint Croix', latitude = 17.72751, longitude = -64.74698, city_source = 'fallback-largest-city' where name = 'Good Hope School St. Croix' and country = 'Uruguay';
update public.schools set country = 'US Virgin Islands', country_code = 'VI', city = 'Saint Croix', latitude = 17.72751, longitude = -64.74698, city_source = 'fallback-largest-city' where name = 'Virgin Islands Montessori School & Peter Gruber International Academy' and country = 'Uruguay';
update public.schools set country = 'Cayman Islands', country_code = 'KY', city = 'George Town', latitude = 19.2866, longitude = -81.37436, city_source = 'manual' where name = 'British West Indies Collegiate' and country = 'Vietnam';
update public.schools set country = 'Antigua and Barbuda', country_code = 'AG', city = 'Saint John’s', latitude = 17.12096, longitude = -61.84329, city_source = 'manual' where name = 'Island Academy Antigua' and country = 'Vietnam';

-- One record for the renamed Seoul school.
delete from public.schools
 where country = 'South Korea' and name = 'International Christian School Seoul'
   and not exists (select 1 from public.postings p where p.school_id = schools.id);
update public.schools
   set name = 'Yongsan International School Seoul (formerly International Christian School)',
       is_verified = true
 where country = 'South Korea' and name = 'Yongsan International School Seoul';

-- Belt and braces: fail the migration if anything is still where it shouldn't be.
do $$
declare n int;
begin
  select count(*) into n from public.schools
   where (country = 'Kenya' and (name ilike '%seoul%' or name ilike '%busan%' or name ilike '%korea%'))
      or (country = 'Tunisia' and (name ilike '%istanbul%' or name ilike '%ankara%' or name ilike '%izmir%'))
      or (country = 'Ghana' and (name ilike '%london%' or name ilike '%cobham%'));
  if n > 0 then raise exception 'still misfiled: % schools', n; end if;
end $$;
