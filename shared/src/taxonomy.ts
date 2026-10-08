/**
 * Curated vocabulary used to turn TMDB genres + keywords into wizard answers.
 *
 * Terms are matched against TMDB keywords (lowercase) either exactly or as a
 * whole-word phrase inside a longer keyword ("zombie" matches "zombie apocalypse").
 * `strong` terms score 2, `weak` terms score 1. A tag is assigned once its score
 * reaches the definition's threshold.
 */

export interface GenreDef {
  id: string; // TMDB genre name, as Radarr reports it
  label: string;
  icon: string; // lucide icon name
  color: string;
}

export const GENRES: GenreDef[] = [
  { id: 'Action', label: 'Action', icon: 'Zap', color: '#dc2626' },
  { id: 'Adventure', label: 'Adventure', icon: 'Compass', color: '#ea580c' },
  { id: 'Animation', label: 'Animation', icon: 'Palette', color: '#0891b2' },
  { id: 'Comedy', label: 'Comedy', icon: 'Laugh', color: '#ca8a04' },
  { id: 'Crime', label: 'Crime', icon: 'Siren', color: '#475569' },
  { id: 'Documentary', label: 'Documentary', icon: 'Camera', color: '#059669' },
  { id: 'Drama', label: 'Drama', icon: 'Drama', color: '#7c3aed' },
  { id: 'Family', label: 'Family', icon: 'Users', color: '#16a34a' },
  { id: 'Fantasy', label: 'Fantasy', icon: 'WandSparkles', color: '#9333ea' },
  { id: 'History', label: 'History', icon: 'Landmark', color: '#a16207' },
  { id: 'Horror', label: 'Horror', icon: 'Skull', color: '#991b1b' },
  { id: 'Music', label: 'Music', icon: 'Music', color: '#db2777' },
  { id: 'Mystery', label: 'Mystery', icon: 'Search', color: '#4f46e5' },
  { id: 'Romance', label: 'Romance', icon: 'Heart', color: '#e11d48' },
  { id: 'Science Fiction', label: 'Sci-Fi', icon: 'Rocket', color: '#2563eb' },
  { id: 'Thriller', label: 'Thriller', icon: 'Eye', color: '#334155' },
  { id: 'War', label: 'War', icon: 'Shield', color: '#57534e' },
  { id: 'Western', label: 'Western', icon: 'Sunset', color: '#b45309' },
  { id: 'TV Movie', label: 'TV Movie', icon: 'Tv', color: '#64748b' },
];

export interface ThemeDef {
  id: string;
  label: string;
  icon: string;
  strong: string[];
  weak?: string[];
  /** Genres that imply the theme on their own. */
  genres?: string[];
  /** Fallback for movies with few keywords. */
  overview?: RegExp;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'superheroes', label: 'Superheroes', icon: 'Zap',
    strong: ['superhero', 'superheroine', 'super power', 'superpowers', 'superhuman', 'marvel cinematic universe (mcu)', 'dc extended universe (dceu)', 'dc universe (dcu)', 'mutant', 'masked vigilante', 'superhero team'],
    weak: ['based on comic', 'vigilante', 'based on graphic novel'],
    overview: /\bsuper-?heroe?s?\b|\bsuper-?powers?\b|\bmutants?\b/,
  },
  {
    id: 'supernatural', label: 'Supernatural', icon: 'Ghost',
    strong: ['supernatural', 'ghost', 'haunted house', 'haunting', 'demon', 'demonic possession', 'possession', 'exorcism', 'poltergeist', 'paranormal', 'occult', 'evil spirit', 'afterlife', 'séance', 'curse', 'spirit'],
    weak: ['devil', 'satan', 'witch'],
    overview: /\bghosts?\b|\bhaunt|\bdemon|\bpossess(ed|ion)\b|\bsupernatural\b|\bparanormal\b/,
  },
  {
    id: 'monsters', label: 'Monsters & Creatures', icon: 'Bug',
    strong: ['monster', 'giant monster', 'kaiju', 'creature', 'sea monster', 'creature feature', 'godzilla', 'werewolf', 'dinosaur', 'mutation', 'giant animal'],
    weak: ['beast', 'shark attack'],
    overview: /\bmonsters?\b|\bcreatures?\b|\bdinosaurs?\b/,
  },
  {
    id: 'vampires', label: 'Vampires', icon: 'Moon',
    strong: ['vampire', 'vampires', 'dracula', 'bloodsucker'],
    overview: /\bvampires?\b|\bdracula\b/,
  },
  {
    id: 'zombies', label: 'Zombies', icon: 'Biohazard',
    strong: ['zombie', 'zombies', 'zombie apocalypse', 'undead', 'living dead'],
    weak: ['outbreak', 'epidemic', 'pandemic', 'virus', 'infection'],
    overview: /\bzombies?\b|\bundead\b/,
  },
  {
    id: 'slashers', label: 'Slashers & Killers', icon: 'Skull',
    strong: ['slasher', 'serial killer', 'masked killer', 'psychopath', 'home invasion', 'final girl', 'killer'],
    weak: ['murder', 'stalker'],
    overview: /\bserial killer\b|\bslasher\b|\bmasked killer\b/,
  },
  {
    id: 'romance', label: 'Love & Romance', icon: 'Heart', genres: ['Romance'],
    strong: ['romance', 'love', 'falling in love', 'romantic comedy', 'love triangle', 'first love', 'lovers', 'star crossed lovers', 'forbidden love', 'love at first sight', 'wedding'],
    weak: ['relationship', 'dating', 'marriage'],
    overview: /\bfall(s|ing)? in love\b|\bromance\b|\blove story\b/,
  },
  {
    id: 'heist', label: 'Heists & Cons', icon: 'Gem',
    strong: ['heist', 'bank robbery', 'robbery', 'thief', 'con artist', 'con man', 'burglary', 'swindle', 'jewel thief', 'criminal mastermind', 'scam', 'casino'],
    weak: ['theft', 'stealing'],
    overview: /\bheist\b|\brob(bery|bers?)\b|\bthie(f|ves)\b|\bcon artists?\b/,
  },
  {
    id: 'space', label: 'Space', icon: 'Rocket',
    strong: ['space', 'outer space', 'space travel', 'astronaut', 'spacecraft', 'space station', 'space opera', 'spaceship', 'space mission', 'mars', 'galaxy', 'space exploration'],
    weak: ['planet', 'moon'],
    overview: /\bouter space\b|\bspace(ship|craft| station)\b|\bastronauts?\b|\bgalaxy\b/,
  },
  {
    id: 'aliens', label: 'Aliens', icon: 'Orbit',
    strong: ['alien', 'aliens', 'extraterrestrial', 'alien invasion', 'alien life-form', 'ufo', 'first contact', 'alien abduction'],
    overview: /\baliens?\b|\bextraterrestrials?\b|\bufos?\b/,
  },
  {
    id: 'time-travel', label: 'Time Travel', icon: 'Hourglass',
    strong: ['time travel', 'time loop', 'time machine', 'time paradox', 'alternate timeline', 'time traveler'],
    overview: /\btime travel|\btime machine\b|\btime loop\b|\bback in time\b/,
  },
  {
    id: 'ai-robots', label: 'AI & Robots', icon: 'Bot',
    strong: ['artificial intelligence (a.i.)', 'artificial intelligence', 'robot', 'robots', 'android', 'cyborg', 'humanoid robot', 'killer robot', 'sentient ai'],
    weak: ['hacker', 'technology', 'computer'],
    overview: /\brobots?\b|\bandroids?\b|\bartificial intelligence\b|\bcyborgs?\b/,
  },
  {
    id: 'dystopia', label: 'Dystopia & Apocalypse', icon: 'Radiation',
    strong: ['dystopia', 'dystopian', 'post-apocalyptic future', 'post-apocalyptic', 'apocalypse', 'totalitarian regime', 'end of the world', 'nuclear war', 'wasteland'],
    weak: ['future', 'rebellion'],
    overview: /\bdystopi|\bpost-apocalyptic\b|\bapocalypse\b|\bwasteland\b/,
  },
  {
    id: 'magic', label: 'Magic & Wizards', icon: 'WandSparkles',
    strong: ['magic', 'magical', 'wizard', 'witchcraft', 'sorcery', 'sorcerer', 'sword and sorcery', 'spell', 'witch', 'wizardry', 'magic school'],
    overview: /\bmagic(al)?\b|\bwizards?\b|\bsorcer|\bwitch(es|craft)?\b/,
  },
  {
    id: 'mythology', label: 'Myths & Dragons', icon: 'Castle',
    strong: ['dragon', 'mythology', 'greek mythology', 'norse mythology', 'mythical creature', 'greek god', 'knight', 'elves', 'dwarf', 'orc', 'high fantasy', 'sword and sandal', 'middle-earth (tolkien)'],
    weak: ['quest', 'kingdom', 'medieval', 'gods'],
    overview: /\bdragons?\b|\bknights?\b|\bkingdom\b|\bgods\b/,
  },
  {
    id: 'survival', label: 'Survival', icon: 'Mountain',
    strong: ['survival', 'stranded', 'wilderness', 'shipwreck', 'plane crash', 'deserted island', 'lost at sea', 'mountain climbing', 'survivalist'],
    weak: ['desert', 'arctic', 'jungle'],
    overview: /\bsurviv(e|al|ors?)\b|\bstranded\b|\bwilderness\b/,
  },
  {
    id: 'disaster', label: 'Disaster', icon: 'Tornado',
    strong: ['disaster', 'natural disaster', 'disaster movie', 'earthquake', 'tsunami', 'tornado', 'volcano', 'asteroid', 'meteor', 'sinking ship', 'catastrophe'],
    weak: ['flood', 'storm'],
    overview: /\bdisaster\b|\bearthquake\b|\btsunami\b|\basteroid\b|\bvolcano\b/,
  },
  {
    id: 'revenge', label: 'Revenge', icon: 'Flame',
    strong: ['revenge', 'vengeance', 'vigilante justice', 'retribution', 'revenge plot'],
    weak: ['rampage', 'vigilante'],
    overview: /\brevenge\b|\bvengeance\b/,
  },
  {
    id: 'spies', label: 'Spies & Espionage', icon: 'Glasses',
    strong: ['spy', 'espionage', 'secret agent', 'cia', 'mi6', 'kgb', 'double agent', 'secret mission', 'secret service', 'spy thriller'],
    weak: ['undercover', 'cold war', 'conspiracy'],
    overview: /\bspy\b|\bspies\b|\bespionage\b|\bsecret agent\b|\bcia\b|\bmi6\b/,
  },
  {
    id: 'assassins', label: 'Hitmen & Assassins', icon: 'Crosshair',
    strong: ['hitman', 'assassin', 'contract killer', 'assassination', 'mercenary', 'one man army'],
    weak: ['bodyguard'],
    overview: /\bhit-?man\b|\bassassins?\b|\bcontract killer\b/,
  },
  {
    id: 'martial-arts', label: 'Martial Arts', icon: 'Swords',
    strong: ['martial arts', 'kung fu', 'karate', 'samurai', 'ninja', 'wuxia', 'sword fight', 'fighting tournament'],
    weak: ['fight', 'tournament'],
    overview: /\bmartial arts?\b|\bkung fu\b|\bkarate\b|\bsamurai\b|\bninjas?\b/,
  },
  {
    id: 'war', label: 'War Stories', icon: 'Shield', genres: ['War'],
    strong: ['world war ii', 'world war i', 'vietnam war', 'war', 'battle', 'soldier', 'military', 'd-day', 'war hero', 'prisoner of war', 'combat', 'civil war'],
    weak: ['army', 'navy'],
    overview: /\bsoldiers?\b|\bbattlefield\b|\bworld war\b/,
  },
  {
    id: 'true-story', label: 'True Stories', icon: 'BookOpen',
    strong: ['based on true story', 'based on a true story', 'biography', 'true story', 'biographical', 'historical figure', 'real person', 'based on real events', 'docudrama'],
    weak: ['historical event'],
    overview: /\btrue story\b|\bbased on real\b|\breal-life\b/,
  },
  {
    id: 'coming-of-age', label: 'Coming of Age', icon: 'GraduationCap',
    strong: ['coming of age', 'teenager', 'high school', 'adolescence', 'growing up', 'summer camp', 'boarding school', 'teen'],
    weak: ['school', 'first love', 'friendship'],
    overview: /\bcoming of age\b|\bteen(age|ager)?s?\b|\bhigh school\b|\bgrowing up\b/,
  },
  {
    id: 'whodunit', label: 'Whodunits & Detectives', icon: 'Fingerprint',
    strong: ['whodunit', 'murder mystery', 'detective', 'private detective', 'police detective', 'murder investigation', 'sherlock holmes', 'investigation', 'missing person'],
    weak: ['mystery', 'crime scene', 'police'],
    overview: /\bdetectives?\b|\bmurder mystery\b|\binvestigat|\bwhodunit\b/,
  },
  {
    id: 'gangsters', label: 'Gangsters & Mob', icon: 'Briefcase',
    strong: ['gangster', 'mafia', 'mob', 'organized crime', 'crime boss', 'drug cartel', 'yakuza', 'mobster', 'crime family', 'drug trafficking', 'cartel', 'gang'],
    weak: ['drug dealer', 'drugs'],
    overview: /\bgangsters?\b|\bmafia\b|\bmob(ster)?s?\b|\bcartel\b|\bcrime boss\b/,
  },
  {
    id: 'road-trip', label: 'Road Trips & Journeys', icon: 'Map',
    strong: ['road trip', 'road movie', 'cross-country', 'journey'],
    weak: ['travel', 'trip'],
    overview: /\broad trip\b|\bcross-country\b/,
  },
  {
    id: 'sports', label: 'Sports', icon: 'Trophy',
    strong: ['sports', 'sport', 'boxing', 'boxer', 'football (soccer)', 'american football', 'basketball', 'baseball', 'ice hockey', 'tennis', 'golf', 'olympic games', 'athlete', 'wrestling', 'surfing', 'sports team'],
    weak: ['coach', 'underdog', 'competition'],
    overview: /\bboxing\b|\bboxer\b|\bfootball\b|\bbasketball\b|\bbaseball\b|\bchampionship\b|\bolympic/,
  },
  {
    id: 'animals', label: 'Animals', icon: 'PawPrint',
    strong: ['animal', 'animals', 'dog', 'cat', 'talking animal', 'horse', 'wildlife', 'pet', 'anthropomorphism'],
    weak: ['wolf', 'lion', 'bear', 'fox', 'bird'],
  },
  {
    id: 'fairy-tales', label: 'Fairy Tales', icon: 'Sparkles',
    strong: ['fairy tale', 'based on fairy tale', 'princess', 'fairy', 'fairy godmother', 'enchanted', 'prince'],
    weak: ['kingdom', 'castle'],
    overview: /\bfairy[- ]tale\b|\bprincess\b|\benchanted\b/,
  },
  {
    id: 'found-footage', label: 'Found Footage', icon: 'Video',
    strong: ['found footage', 'mockumentary', 'camcorder', 'pov'],
    overview: /\bfound footage\b/,
  },
  {
    id: 'psychological', label: 'Psychological', icon: 'Eye',
    strong: ['psychological thriller', 'psychological horror', 'psychological', 'mental illness', 'paranoia', 'obsession', 'insanity', 'hallucination', 'delusion', 'schizophrenia', 'gaslighting', 'manipulation', 'unreliable narrator'],
    weak: ['psychiatrist', 'identity crisis'],
    overview: /\bpsycholog|\bparanoi|\bobsess|\bsanity\b/,
  },
  {
    id: 'courtroom', label: 'Courtroom', icon: 'Gavel',
    strong: ['courtroom', 'trial', 'lawyer', 'attorney', 'court case', 'legal drama', 'jury', 'lawsuit'],
    weak: ['judge', 'justice'],
    overview: /\btrial\b|\blawyers?\b|\battorneys?\b|\bcourtroom\b|\bjury\b/,
  },
  {
    id: 'racing', label: 'Cars & Racing', icon: 'Car',
    strong: ['car race', 'racing', 'street racing', 'car chase', 'race car', 'race car driver', 'formula 1', 'nascar', 'getaway driver', 'motorcycle'],
    weak: ['car', 'cars', 'driver'],
    overview: /\bracing\b|\brace car\b|\bstreet race\b/,
  },
  {
    id: 'pirates', label: 'Pirates & Treasure', icon: 'Anchor',
    strong: ['pirate', 'pirates', 'treasure hunt', 'treasure', 'swashbuckler', 'high seas', 'treasure map'],
    weak: ['ship', 'sailing', 'sea'],
    overview: /\bpirates?\b|\btreasure\b/,
  },
  {
    id: 'music', label: 'Music & Musicals', icon: 'Music', genres: ['Music'],
    strong: ['musical', 'music', 'singer', 'rock band', 'musician', 'concert', 'dance', 'dancing', 'hip-hop', 'jazz', 'broadway', 'band'],
    overview: /\bsingers?\b|\bmusicians?\b|\bband\b/,
  },
  {
    id: 'holidays', label: 'Holidays', icon: 'TreePine',
    strong: ['christmas', 'holiday', 'christmas eve', 'santa claus', 'thanksgiving', "new year's eve", 'halloween'],
    overview: /\bchristmas\b|\bsanta\b|\bthanksgiving\b|\bhalloween\b/,
  },
  {
    id: 'realities', label: 'Dreams & Other Worlds', icon: 'Infinity',
    strong: ['parallel world', 'multiverse', 'alternate reality', 'simulation', 'simulated reality', 'virtual reality', 'dream', 'dream world', 'alternate universe', 'other dimension', 'portal'],
    overview: /\bparallel (world|universe)s?\b|\bmultiverse\b|\balternate reality\b|\bsimulation\b|\bdreams?\b/,
  },
  {
    id: 'historical', label: 'Historical Epics', icon: 'Landmark', genres: ['History'],
    strong: ['ancient rome', 'ancient greece', 'ancient egypt', 'roman empire', 'gladiator', 'viking', 'victorian era', 'period drama', 'costume drama', 'historical', '19th century', '18th century', '17th century', '16th century', 'middle ages'],
    weak: ['medieval', 'empire', 'royalty', 'king', 'queen'],
    overview: /\b1\d(th)? century\b|\bancient\b|\bmedieval\b/,
  },
];

export interface MoodDef {
  id: string;
  label: string;
  description: string;
  icon: string;
  genres: Record<string, number>;
  strong: string[];
  weak?: string[];
  /** Terms or genres that pull a movie away from this mood. */
  negative?: string[];
  negativeGenres?: Record<string, number>;
  /** Genres that rule the mood out completely. */
  excludeGenres?: string[];
  runtimeBonus?: { min: number; bonus: number }[];
  threshold: number;
}

export const MOODS: MoodDef[] = [
  {
    id: 'light', label: 'Light & Fun', description: 'Easy laughs, nothing heavy', icon: 'Laugh',
    genres: { Comedy: 2, Animation: 1, Family: 1 },
    strong: ['lighthearted', 'light-hearted', 'hilarious', 'playful', 'whimsical', 'amused', 'cheerful', 'joyful', 'funny', 'silly', 'absurd', 'slapstick', 'parody', 'spoof', 'buddy comedy', 'romantic comedy', 'satire', 'quirky', 'witty', 'comedic', 'farce'],
    negative: ['dark comedy', 'black comedy', 'tragedy', 'grief', 'death of a child'],
    excludeGenres: ['Horror', 'War'],
    threshold: 2,
  },
  {
    id: 'feel-good', label: 'Feel-Good', description: 'Warm, uplifting, leaves you smiling', icon: 'Smile',
    genres: { Family: 1, Romance: 1, Music: 1, Animation: 1 },
    strong: ['heartwarming', 'hopeful', 'inspirational', 'comforting', 'feel-good', 'feel good', 'uplifting', 'sentimental', 'wholesome', 'inspiring', 'joyous', 'triumphant', 'optimistic', 'sweet', 'tender', 'heartfelt', 'celebratory'],
    weak: ['friendship', 'family relationships', 'underdog', 'second chance'],
    negative: ['bleak', 'disturbing', 'depressing', 'tragedy'],
    excludeGenres: ['Horror'],
    threshold: 2,
  },
  {
    id: 'edge', label: 'Edge of Your Seat', description: 'Tense, gripping, pulse-pounding', icon: 'HeartPulse',
    genres: { Thriller: 2, Action: 1, Horror: 1, Mystery: 1, Crime: 1 },
    strong: ['suspenseful', 'tense', 'intense', 'thrilling', 'exciting', 'suspense', 'nail-biting', 'adrenaline', 'cat and mouse', 'race against time', 'high stakes', 'ticking clock', 'manhunt', 'hostage', 'escape', 'chase'],
    weak: ['survival', 'conspiracy', 'pursuit'],
    negativeGenres: { Family: 1, Animation: 1 },
    threshold: 2,
  },
  {
    id: 'dark', label: 'Dark & Heavy', description: 'Bleak, haunting, hits hard', icon: 'CloudMoon',
    genres: { Horror: 1, Crime: 1, War: 1, Drama: 0.5, Thriller: 0.5 },
    strong: ['dark', 'grim', 'bleak', 'disturbing', 'depressing', 'melancholy', 'harsh', 'brutal', 'gritty', 'tragic', 'tragedy', 'violence', 'violent', 'nihilism', 'cruelty', 'grief', 'despair', 'sinister', 'ominous', 'gloomy', 'dread', 'gore', 'holocaust', 'sadistic', 'drug addiction', 'abuse', 'dark comedy', 'neo-noir', 'film noir'],
    weak: ['death', 'murder', 'addiction', 'loss', 'suicide', 'corruption'],
    negative: ['lighthearted', 'whimsical', 'heartwarming', 'hilarious'],
    negativeGenres: { Family: 2, Animation: 1, Comedy: 1 },
    threshold: 2,
  },
  {
    id: 'mind-bending', label: 'Mind-Bending', description: 'Twisty, cerebral, makes you think', icon: 'Brain',
    genres: { 'Science Fiction': 1, Mystery: 1 },
    strong: ['mind-bending', 'mind bending', 'twist ending', 'plot twist', 'surprise ending', 'nonlinear timeline', 'non-linear narrative', 'time loop', 'surreal', 'surrealism', 'cerebral', 'thought-provoking', 'philosophical', 'parallel world', 'multiverse', 'simulation', 'simulated reality', 'memory loss', 'amnesia', 'unreliable narrator', 'paradox', 'existentialism', 'alternate reality', 'reality vs fantasy', 'consciousness', 'hallucination', 'dream', 'complex', 'puzzle'],
    weak: ['psychological', 'identity', 'time travel', 'mystery'],
    negativeGenres: { Family: 1 },
    threshold: 2,
  },
  {
    id: 'epic', label: 'Something Epic', description: 'Big, sweeping, a proper event', icon: 'Crown',
    genres: { Adventure: 1, Fantasy: 1, War: 1, History: 1 },
    strong: ['epic', 'grand', 'sweeping', 'ambitious', 'saga', 'war epic', 'historical epic', 'legend', 'battle'],
    weak: ['quest', 'kingdom', 'empire', 'journey'],
    runtimeBonus: [{ min: 150, bonus: 1.5 }, { min: 135, bonus: 0.5 }],
    threshold: 2.5,
  },
];

export interface TimeOption {
  id: string;
  label: string;
  description: string;
  icon: string;
  maxRuntime: number | null;
}

export const TIME_OPTIONS: TimeOption[] = [
  { id: 'quick', label: 'A quick one', description: 'Under 1h45', icon: 'Timer', maxRuntime: 105 },
  { id: 'standard', label: 'A regular movie', description: 'Up to 2h15', icon: 'Clock', maxRuntime: 135 },
  { id: 'any', label: "I've got all night", description: 'Any length', icon: 'Moon', maxRuntime: null },
];

/** Certifications allowed per Plex Home restriction profile (US, UK and DE ratings). */
export const RESTRICTION_CERTS: Record<'little_kid' | 'older_kid' | 'teen', string[]> = {
  little_kid: ['G', 'TV-Y', 'TV-Y7', 'TV-G', 'U', '0'],
  older_kid: ['G', 'TV-Y', 'TV-Y7', 'TV-G', 'U', '0', 'PG', 'TV-PG', '6'],
  teen: ['G', 'TV-Y', 'TV-Y7', 'TV-G', 'U', '0', 'PG', 'TV-PG', '6', 'PG-13', 'TV-14', '12', '12A'],
};

export const STEP_ORDER = ['genre', 'theme', 'mood', 'time'] as const;

/** An option is only offered when at least this many movies match it. */
export const MIN_OPTION_COUNT = 3;

export const themeById = new Map(THEMES.map((t) => [t.id, t]));
export const moodById = new Map(MOODS.map((m) => [m.id, m]));
export const genreById = new Map(GENRES.map((g) => [g.id, g]));
export const timeById = new Map(TIME_OPTIONS.map((t) => [t.id, t]));
