-- ============================================================================
-- Every country on Earth, so nobody's career is missing from the list.
--
-- Paul, 20 Sep 2026: "Sarah had asked me to add Benin. Let's get to the bottom
-- of that by adding all countries."
--
-- Benin has no school in the catalogue, and the country dropdown was built from
-- the schools we hold — so Benin was not missing from a list, it had never been
-- ON one. 85 countries were in that position. Sarah asked; the other 84 nobody
-- asked about, because a person who does not see their country assumes the site
-- is not for them and closes it.
--
-- OUR SPELLING ALWAYS WINS. Degrees compare country as TEXT — `a_country =
-- b_country` in pair_degree — so a second spelling of one country is two
-- countries, and two colleagues in Abidjan would never meet. Eleven names
-- differ between the gazetteer and this database, and in every case the name
-- already in `schools` is kept:
--
--   ours              gazetteer
--   DR Congo          Democratic Republic of the Congo
--   Congo             Republic of the Congo
--   Côte d'Ivoire     Ivory Coast
--   Curaçao           Curacao
--   Czech Republic    Czechia
--   Macau             Macao
--   Netherlands       The Netherlands
--   Palestine         Palestinian Territory
--   East Timor        Timor Leste
--   Virgin Islands, British / US Virgin Islands
--
-- Netherlands Antilles and Serbia and Montenegro no longer exist. They are kept
-- on purpose: this is a record of where people WORKED, and somebody teaching in
-- Curaçao in 2005 taught in the Netherlands Antilles.
-- ============================================================================

create table if not exists public.countries (
  code       text primary key check (length(code) = 2),
  name       text not null unique,
  continent  text
);

alter table public.countries enable row level security;

drop policy if exists countries_read on public.countries;
create policy countries_read on public.countries
  for select to authenticated using (true);
grant select on public.countries to authenticated;

insert into public.countries (code, name, continent) values
('AF', 'Afghanistan', 'AS'),
  ('AX', 'Aland Islands', 'EU'),
  ('AL', 'Albania', 'EU'),
  ('DZ', 'Algeria', 'AF'),
  ('AS', 'American Samoa', 'OC'),
  ('AD', 'Andorra', 'EU'),
  ('AO', 'Angola', 'AF'),
  ('AI', 'Anguilla', 'NA'),
  ('AQ', 'Antarctica', 'AN'),
  ('AG', 'Antigua and Barbuda', 'NA'),
  ('AR', 'Argentina', 'SA'),
  ('AM', 'Armenia', 'AS'),
  ('AW', 'Aruba', 'NA'),
  ('AU', 'Australia', 'OC'),
  ('AT', 'Austria', 'EU'),
  ('AZ', 'Azerbaijan', 'AS'),
  ('BS', 'Bahamas', 'NA'),
  ('BH', 'Bahrain', 'AS'),
  ('BD', 'Bangladesh', 'AS'),
  ('BB', 'Barbados', 'NA'),
  ('BY', 'Belarus', 'EU'),
  ('BE', 'Belgium', 'EU'),
  ('BZ', 'Belize', 'NA'),
  ('BJ', 'Benin', 'AF'),
  ('BM', 'Bermuda', 'NA'),
  ('BT', 'Bhutan', 'AS'),
  ('BO', 'Bolivia', 'SA'),
  ('BQ', 'Bonaire, Saint Eustatius and Saba ', 'NA'),
  ('BA', 'Bosnia and Herzegovina', 'EU'),
  ('BW', 'Botswana', 'AF'),
  ('BV', 'Bouvet Island', 'AN'),
  ('BR', 'Brazil', 'SA'),
  ('IO', 'British Indian Ocean Territory', 'AS'),
  ('VG', 'Virgin Islands, British', 'NA'),
  ('BN', 'Brunei', 'AS'),
  ('BG', 'Bulgaria', 'EU'),
  ('BF', 'Burkina Faso', 'AF'),
  ('BI', 'Burundi', 'AF'),
  ('CV', 'Cabo Verde', 'AF'),
  ('KH', 'Cambodia', 'AS'),
  ('CM', 'Cameroon', 'AF'),
  ('CA', 'Canada', 'NA'),
  ('KY', 'Cayman Islands', 'NA'),
  ('CF', 'Central African Republic', 'AF'),
  ('TD', 'Chad', 'AF'),
  ('CL', 'Chile', 'SA'),
  ('CN', 'China', 'AS'),
  ('CX', 'Christmas Island', 'OC'),
  ('CC', 'Cocos Islands', 'AS'),
  ('CO', 'Colombia', 'SA'),
  ('KM', 'Comoros', 'AF'),
  ('CK', 'Cook Islands', 'OC'),
  ('CR', 'Costa Rica', 'NA'),
  ('HR', 'Croatia', 'EU'),
  ('CU', 'Cuba', 'NA'),
  ('CW', 'Curaçao', 'NA'),
  ('CY', 'Cyprus', 'EU'),
  ('CZ', 'Czech Republic', 'EU'),
  ('CD', 'DR Congo', 'AF'),
  ('DK', 'Denmark', 'EU'),
  ('DJ', 'Djibouti', 'AF'),
  ('DM', 'Dominica', 'NA'),
  ('DO', 'Dominican Republic', 'NA'),
  ('EC', 'Ecuador', 'SA'),
  ('EG', 'Egypt', 'AF'),
  ('SV', 'El Salvador', 'NA'),
  ('GQ', 'Equatorial Guinea', 'AF'),
  ('ER', 'Eritrea', 'AF'),
  ('EE', 'Estonia', 'EU'),
  ('SZ', 'Eswatini', 'AF'),
  ('ET', 'Ethiopia', 'AF'),
  ('FK', 'Falkland Islands', 'SA'),
  ('FO', 'Faroe Islands', 'EU'),
  ('FJ', 'Fiji', 'OC'),
  ('FI', 'Finland', 'EU'),
  ('FR', 'France', 'EU'),
  ('GF', 'French Guiana', 'SA'),
  ('PF', 'French Polynesia', 'OC'),
  ('TF', 'French Southern Territories', 'AN'),
  ('GA', 'Gabon', 'AF'),
  ('GM', 'Gambia', 'AF'),
  ('GE', 'Georgia', 'AS'),
  ('DE', 'Germany', 'EU'),
  ('GH', 'Ghana', 'AF'),
  ('GI', 'Gibraltar', 'EU'),
  ('GR', 'Greece', 'EU'),
  ('GL', 'Greenland', 'NA'),
  ('GD', 'Grenada', 'NA'),
  ('GP', 'Guadeloupe', 'NA'),
  ('GU', 'Guam', 'OC'),
  ('GT', 'Guatemala', 'NA'),
  ('GG', 'Guernsey', 'EU'),
  ('GN', 'Guinea', 'AF'),
  ('GW', 'Guinea-Bissau', 'AF'),
  ('GY', 'Guyana', 'SA'),
  ('HT', 'Haiti', 'NA'),
  ('HM', 'Heard Island and McDonald Islands', 'AN'),
  ('HN', 'Honduras', 'NA'),
  ('HK', 'Hong Kong', 'AS'),
  ('HU', 'Hungary', 'EU'),
  ('IS', 'Iceland', 'EU'),
  ('IN', 'India', 'AS'),
  ('ID', 'Indonesia', 'AS'),
  ('IR', 'Iran', 'AS'),
  ('IQ', 'Iraq', 'AS'),
  ('IE', 'Ireland', 'EU'),
  ('IM', 'Isle of Man', 'EU'),
  ('IL', 'Israel', 'AS'),
  ('IT', 'Italy', 'EU'),
  ('CI', 'Côte d''Ivoire', 'AF'),
  ('JM', 'Jamaica', 'NA'),
  ('JP', 'Japan', 'AS'),
  ('JE', 'Jersey', 'EU'),
  ('JO', 'Jordan', 'AS'),
  ('KZ', 'Kazakhstan', 'AS'),
  ('KE', 'Kenya', 'AF'),
  ('KI', 'Kiribati', 'OC'),
  ('XK', 'Kosovo', 'EU'),
  ('KW', 'Kuwait', 'AS'),
  ('KG', 'Kyrgyzstan', 'AS'),
  ('LA', 'Laos', 'AS'),
  ('LV', 'Latvia', 'EU'),
  ('LB', 'Lebanon', 'AS'),
  ('LS', 'Lesotho', 'AF'),
  ('LR', 'Liberia', 'AF'),
  ('LY', 'Libya', 'AF'),
  ('LI', 'Liechtenstein', 'EU'),
  ('LT', 'Lithuania', 'EU'),
  ('LU', 'Luxembourg', 'EU'),
  ('MO', 'Macau', 'AS'),
  ('MG', 'Madagascar', 'AF'),
  ('MW', 'Malawi', 'AF'),
  ('MY', 'Malaysia', 'AS'),
  ('MV', 'Maldives', 'AS'),
  ('ML', 'Mali', 'AF'),
  ('MT', 'Malta', 'EU'),
  ('MH', 'Marshall Islands', 'OC'),
  ('MQ', 'Martinique', 'NA'),
  ('MR', 'Mauritania', 'AF'),
  ('MU', 'Mauritius', 'AF'),
  ('YT', 'Mayotte', 'AF'),
  ('MX', 'Mexico', 'NA'),
  ('FM', 'Micronesia', 'OC'),
  ('MD', 'Moldova', 'EU'),
  ('MC', 'Monaco', 'EU'),
  ('MN', 'Mongolia', 'AS'),
  ('ME', 'Montenegro', 'EU'),
  ('MS', 'Montserrat', 'NA'),
  ('MA', 'Morocco', 'AF'),
  ('MZ', 'Mozambique', 'AF'),
  ('MM', 'Myanmar', 'AS'),
  ('NA', 'Namibia', 'AF'),
  ('NR', 'Nauru', 'OC'),
  ('NP', 'Nepal', 'AS'),
  ('AN', 'Netherlands Antilles', 'NA'),
  ('NC', 'New Caledonia', 'OC'),
  ('NZ', 'New Zealand', 'OC'),
  ('NI', 'Nicaragua', 'NA'),
  ('NE', 'Niger', 'AF'),
  ('NG', 'Nigeria', 'AF'),
  ('NU', 'Niue', 'OC'),
  ('NF', 'Norfolk Island', 'OC'),
  ('KP', 'North Korea', 'AS'),
  ('MK', 'North Macedonia', 'EU'),
  ('MP', 'Northern Mariana Islands', 'OC'),
  ('NO', 'Norway', 'EU'),
  ('OM', 'Oman', 'AS'),
  ('PK', 'Pakistan', 'AS'),
  ('PW', 'Palau', 'OC'),
  ('PS', 'Palestine', 'AS'),
  ('PA', 'Panama', 'NA'),
  ('PG', 'Papua New Guinea', 'OC'),
  ('PY', 'Paraguay', 'SA'),
  ('PE', 'Peru', 'SA'),
  ('PH', 'Philippines', 'AS'),
  ('PN', 'Pitcairn', 'OC'),
  ('PL', 'Poland', 'EU'),
  ('PT', 'Portugal', 'EU'),
  ('PR', 'Puerto Rico', 'NA'),
  ('QA', 'Qatar', 'AS'),
  ('CG', 'Congo', 'AF'),
  ('RE', 'Reunion', 'AF'),
  ('RO', 'Romania', 'EU'),
  ('RU', 'Russia', 'EU'),
  ('RW', 'Rwanda', 'AF'),
  ('BL', 'Saint Barthelemy', 'NA'),
  ('SH', 'Saint Helena', 'AF'),
  ('KN', 'Saint Kitts and Nevis', 'NA'),
  ('LC', 'Saint Lucia', 'NA'),
  ('MF', 'Saint Martin', 'NA'),
  ('PM', 'Saint Pierre and Miquelon', 'NA'),
  ('VC', 'Saint Vincent and the Grenadines', 'NA'),
  ('WS', 'Samoa', 'OC'),
  ('SM', 'San Marino', 'EU'),
  ('ST', 'Sao Tome and Principe', 'AF'),
  ('SA', 'Saudi Arabia', 'AS'),
  ('SN', 'Senegal', 'AF'),
  ('RS', 'Serbia', 'EU'),
  ('CS', 'Serbia and Montenegro', 'EU'),
  ('SC', 'Seychelles', 'AF'),
  ('SL', 'Sierra Leone', 'AF'),
  ('SG', 'Singapore', 'AS'),
  ('SX', 'Sint Maarten', 'NA'),
  ('SK', 'Slovakia', 'EU'),
  ('SI', 'Slovenia', 'EU'),
  ('SB', 'Solomon Islands', 'OC'),
  ('SO', 'Somalia', 'AF'),
  ('ZA', 'South Africa', 'AF'),
  ('GS', 'South Georgia and the South Sandwich Islands', 'AN'),
  ('KR', 'South Korea', 'AS'),
  ('SS', 'South Sudan', 'AF'),
  ('ES', 'Spain', 'EU'),
  ('LK', 'Sri Lanka', 'AS'),
  ('SD', 'Sudan', 'AF'),
  ('SR', 'Suriname', 'SA'),
  ('SJ', 'Svalbard and Jan Mayen', 'EU'),
  ('SE', 'Sweden', 'EU'),
  ('CH', 'Switzerland', 'EU'),
  ('SY', 'Syria', 'AS'),
  ('TW', 'Taiwan', 'AS'),
  ('TJ', 'Tajikistan', 'AS'),
  ('TZ', 'Tanzania', 'AF'),
  ('TH', 'Thailand', 'AS'),
  ('NL', 'Netherlands', 'EU'),
  ('TL', 'East Timor', 'OC'),
  ('TG', 'Togo', 'AF'),
  ('TK', 'Tokelau', 'OC'),
  ('TO', 'Tonga', 'OC'),
  ('TT', 'Trinidad and Tobago', 'NA'),
  ('TN', 'Tunisia', 'AF'),
  ('TR', 'Turkey', 'AS'),
  ('TM', 'Turkmenistan', 'AS'),
  ('TC', 'Turks and Caicos Islands', 'NA'),
  ('TV', 'Tuvalu', 'OC'),
  ('VI', 'US Virgin Islands', 'NA'),
  ('UG', 'Uganda', 'AF'),
  ('UA', 'Ukraine', 'EU'),
  ('AE', 'United Arab Emirates', 'AS'),
  ('GB', 'United Kingdom', 'EU'),
  ('US', 'United States', 'NA'),
  ('UM', 'United States Minor Outlying Islands', 'OC'),
  ('UY', 'Uruguay', 'SA'),
  ('UZ', 'Uzbekistan', 'AS'),
  ('VU', 'Vanuatu', 'OC'),
  ('VA', 'Vatican', 'EU'),
  ('VE', 'Venezuela', 'SA'),
  ('VN', 'Vietnam', 'AS'),
  ('WF', 'Wallis and Futuna', 'OC'),
  ('EH', 'Western Sahara', 'AF'),
  ('YE', 'Yemen', 'AS'),
  ('ZM', 'Zambia', 'AF'),
  ('ZW', 'Zimbabwe', 'AF')
on conflict (code) do update set name = excluded.name, continent = excluded.continent;

-- A country in `schools` that the gazetteer does not know would silently vanish
-- from the dropdown. There are none today; this makes sure it stays that way.
do $$
declare missing text;
begin
  select string_agg(distinct s.country, ', ') into missing
    from public.schools s
   where s.country is not null
     and not exists (select 1 from public.countries c where c.name = s.country);
  if missing is not null then
    raise exception 'these countries have schools but no row in countries: %', missing;
  end if;
end $$;
