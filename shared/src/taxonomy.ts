/**
 * Curated vocabulary used to turn TMDB genres + keywords into wizard answers.
 *
 * Terms are matched against TMDB keywords (lowercase) either exactly or as a
 * whole-word phrase inside a longer keyword ("zombie" matches "zombie apocalypse").
 * `strong` terms score 2, `weak` terms score 1. Each keyword counts once per tag, through
 * its best term, and each term counts once. Weak terms only add to a tag that has stronger
 * evidence too: a strong term, an implying genre or the plot (for moods, a genre lean, a
 * strong term or the runtime bonus). A tag is assigned once its score reaches the threshold.
 * `npm run tags` shows how the vocabulary fits a real library.
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
  /** Whole keywords that never count toward the theme: idioms like "cat and mouse". */
  exclude?: string[];
  /** Genres that imply the theme on their own. */
  genres?: string[];
  /** Fallback for movies with few keywords, or none that tag anything. */
  overview?: RegExp;
  /** Plot idioms the fallback skips, like "haunted by his past". Needs the `g` flag. */
  overviewExclude?: RegExp;
  /** Score needed; 2 (one strong term) by default. Higher where one keyword is often a side detail. */
  threshold?: number;
}

export const THEMES: ThemeDef[] = [
  {
    id: 'superheroes', label: 'Superheroes', icon: 'Zap',
    strong: ['superhero', 'superheroine', 'super power', 'superpowers', 'superhuman', 'marvel cinematic universe (mcu)', 'dc extended universe (dceu)', 'dc universe (dcu)', 'masked vigilante', 'superhero team'],
    weak: ['based on comic', 'vigilante', 'based on graphic novel', 'mutant', 'supervillain', 'super villain', 'secret identity'],
    overview: /\bsuper-?heroe?s?\b|\bsuper-?powers?\b|\bmutants?\b/,
  },
  {
    id: 'supernatural', label: 'Supernatural', icon: 'Ghost',
    strong: ['supernatural', 'ghost', 'haunted house', 'haunting', 'demon', 'demonic possession', 'possession', 'exorcism', 'poltergeist', 'paranormal', 'occult', 'evil spirit', 'vengeful spirit', 'spirit world', 'afterlife', 'séance', 'curse', 'psychic'],
    // "Spirit" alone is as often "team spirit" or "resistance spirit".
    weak: ['devil', 'satan', 'witch', 'spirit'],
    exclude: ['christmas spirit', 'team spirit', 'free spirit', 'ghost town', 'ghost writer', 'drug possession'],
    overview: /\bghosts?\b|\bhaunt|\bdemon(s|ic|ically)?\b|\bpossess(ed|ion)\b|\bsupernatural\b|\bparanormal\b/,
    // Plots say "haunted by the loss", "comes into possession of" and "face her demons" of anyone.
    overviewExclude: /\bhaunted by\b|\bto haunt\b|\bhaunts (him|her|them|their)\b|\b(in|into|gain|gains|gained|take|takes|took|taking) possession\b|\b(his|her|their|own|personal|inner) demons\b|\bdemons of (his|her|their)\b/g,
  },
  {
    id: 'monsters', label: 'Monsters & Creatures', icon: 'Bug',
    strong: ['monster', 'giant monster', 'kaiju', 'creature', 'sea monster', 'creature feature', 'godzilla', 'werewolf', 'dinosaur', 'giant animal', 'shark attack', 'killer shark', 'great white shark', 'animal horror', 'killer animal', 'giant spider', 'giant snake', 'crocodile', 'alligator'],
    weak: ['beast', 'mutation', 'animal attack', 'shark'],
    exclude: ['loan shark', 'card shark'],
    overview: /\bmonsters?\b|\bcreatures?\b|\bdinosaurs?\b|\bsharks?\b/,
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
    strong: ['slasher', 'serial killer', 'masked killer', 'psychopath', 'final girl', 'killing spree', 'spree killer', 'killer doll', 'killer clown'],
    // A break-in alone is as often a comedy beat (Friendship) or an action opener (Nobody).
    weak: ['murder', 'stalker', 'killer', 'home invasion'],
    overview: /\bserial killer\b|\bslasher\b|\bmasked killer\b/,
  },
  {
    id: 'romance', label: 'Love & Romance', icon: 'Heart', genres: ['Romance'],
    strong: ['romance', 'love', 'falling in love', 'romantic comedy', 'love triangle', 'first love', 'lovers', 'star crossed lovers', 'forbidden love', 'love at first sight'],
    weak: ['romantic relationship', 'dating', 'marriage', 'wedding', 'couple', 'boyfriend', 'girlfriend'],
    overview: /\bfall(s|ing)? in love\b|\bromance\b|\blove story\b/,
  },
  {
    id: 'heist', label: 'Heists & Cons', icon: 'Gem',
    strong: ['heist', 'bank robbery', 'robbery', 'thief', 'con artist', 'con man', 'burglary', 'swindle', 'jewel thief', 'scam', 'caper', 'bank job', 'safecracker'],
    weak: ['theft', 'stealing', 'casino', 'criminal mastermind', 'pickpocket'],
    overview: /\bheist\b|\brob(bery|bers?)\b|\bthie(f|ves)\b|\bcon artists?\b/,
  },
  {
    id: 'space', label: 'Space', icon: 'Rocket',
    strong: ['space', 'outer space', 'space travel', 'astronaut', 'spacecraft', 'space station', 'space opera', 'spaceship', 'space mission', 'mars', 'galaxy', 'space exploration'],
    weak: ['planet', 'moon'],
    exclude: ['liminal space', 'safe space', 'personal space'],
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
    strong: ['artificial intelligence (a.i.)', 'artificial intelligence', 'robot', 'robots', 'android', 'cyborg', 'humanoid robot', 'killer robot', 'sentient ai', 'replicant'],
    weak: ['hacker', 'technology', 'computer'],
    overview: /\brobots?\b|\bandroids?\b|\bartificial intelligence\b|\bcyborgs?\b/,
  },
  {
    id: 'dystopia', label: 'Dystopia & Apocalypse', icon: 'Radiation',
    strong: ['dystopia', 'dystopian', 'post-apocalyptic future', 'post-apocalyptic', 'apocalypse', 'totalitarian regime', 'totalitarianism', 'end of the world', 'nuclear war', 'wasteland', 'cyberpunk'],
    weak: ['future', 'rebellion', 'surveillance'],
    overview: /\bdystopi|\bpost-apocalyptic\b|\bapocalypse\b|\bwasteland\b/,
  },
  {
    id: 'magic', label: 'Magic & Wizards', icon: 'WandSparkles',
    strong: ['magic', 'magical', 'wizard', 'witchcraft', 'sorcery', 'sorcerer', 'sword and sorcery', 'spell', 'witch', 'wizardry', 'magic school'],
    overview: /\bmagic(al)?\b|\bwizards?\b|\bsorcer|\bwitch(es|craft)?\b/,
  },
  {
    id: 'mythology', label: 'Myths & Dragons', icon: 'Castle',
    strong: ['dragon', 'mythology', 'greek mythology', 'norse mythology', 'mythical creature', 'greek god', 'knight', 'elves', 'orc', 'hobbit', 'high fantasy', 'epic fantasy', 'sword and sandal', 'middle-earth (tolkien)'],
    weak: ['quest', 'kingdom', 'medieval', 'gods', 'dwarf', 'fantasy world'],
    overview: /\bdragons?\b|\bknights?\b|\bkingdom\b|\bgods\b/,
  },
  {
    id: 'survival', label: 'Survival', icon: 'Mountain',
    strong: ['survival', 'stranded', 'wilderness', 'plane crash', 'deserted island', 'lost at sea', 'mountain climbing', 'survivalist'],
    weak: ['desert', 'arctic', 'jungle', 'shipwreck'],
    overview: /\bsurviv(e|al|ors?)\b|\bstranded\b|\bwilderness\b/,
  },
  {
    id: 'disaster', label: 'Disaster', icon: 'Tornado',
    strong: ['disaster', 'natural disaster', 'disaster movie', 'earthquake', 'tsunami', 'tornado', 'volcanic eruption', 'asteroid', 'meteor', 'sinking ship', 'catastrophe', 'extreme weather'],
    weak: ['flood', 'storm', 'volcano'],
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
    strong: ['spy', 'espionage', 'secret agent', 'cia', 'central intelligence agency (cia)', 'intelligence agency', 'mi6', 'kgb', 'double agent', 'secret mission', 'secret service', 'spy thriller'],
    weak: ['undercover', 'cold war', 'conspiracy', 'secret organization'],
    overview: /\bspy\b|\bspies\b|\bespionage\b|\bsecret agent\b|\bcia\b|\bmi6\b/,
  },
  {
    id: 'assassins', label: 'Hitmen & Assassins', icon: 'Crosshair',
    strong: ['hitman', 'assassin', 'contract killer', 'hired killer', 'professional killer', 'hired gun', 'assassination', 'mercenary', 'one man army'],
    weak: ['bodyguard'],
    overview: /\bhit-?man\b|\bassassins?\b|\bcontract killer\b/,
  },
  {
    id: 'martial-arts', label: 'Martial Arts', icon: 'Swords',
    strong: ['martial arts', 'kung fu', 'karate', 'samurai', 'ninja', 'wuxia', 'fighting tournament'],
    weak: ['fight', 'tournament', 'sword fight', 'hand to hand combat'],
    overview: /\bmartial arts?\b|\bkung fu\b|\bkarate\b|\bsamurai\b|\bninjas?\b/,
  },
  {
    id: 'war', label: 'War Stories', icon: 'Shield', genres: ['War'],
    strong: ['world war ii', 'world war i', 'vietnam war', 'korean war', 'iraq war', 'war', 'soldier', 'd-day', 'war hero', 'prisoner of war', 'combat', 'civil war'],
    weak: ['army', 'navy', 'military'],
    exclude: ['cold war', 'gang war', 'drug war', 'war on drugs', 'turf war', 'class war', 'post world war i', 'post world war ii', 'post civil war', 'post-war', 'hand to hand combat', 'close-quarters combat', 'trial by combat', 'super soldier'],
    overview: /\bsoldiers?\b|\bbattlefield\b|\bworld war\b/,
  },
  {
    id: 'true-story', label: 'True Stories', icon: 'BookOpen',
    strong: ['based on true story', 'based on a true story', 'biography', 'true story', 'biographical', 'biopic', 'historical figure', 'real person', 'based on real events', 'based on memoir or autobiography', 'true crime', 'docudrama'],
    weak: ['historical event'],
    overview: /\btrue story\b|\bbased on real\b|\breal-life\b/,
  },
  {
    id: 'coming-of-age', label: 'Coming of Age', icon: 'GraduationCap',
    strong: ['coming of age', 'teenager', 'high school', 'adolescence', 'growing up', 'summer camp', 'boarding school', 'teen'],
    // "Teenage girl" is as often the kidnapped daughter of an action movie.
    weak: ['school', 'first love', 'friendship', 'teenage'],
    overview: /\bcoming of age\b|\bteen(age|ager)?s?\b|\bhigh school\b|\bgrowing up\b/,
  },
  {
    id: 'whodunit', label: 'Whodunits & Detectives', icon: 'Fingerprint',
    strong: ['whodunit', 'murder mystery', 'detective', 'private detective', 'police detective', 'murder investigation', 'sherlock holmes', 'investigation'],
    // A missing person is as often a comedy's setup (The Fall Guy) or a horror's (Get Out).
    weak: ['mystery', 'crime scene', 'police', 'fbi', 'missing person'],
    exclude: ['paranormal investigation', 'paranormal investigator'],
    overview: /\bdetectives?\b|\bmurder mystery\b|\binvestigat|\bwhodunit\b/,
  },
  {
    id: 'gangsters', label: 'Gangsters & Mob', icon: 'Briefcase',
    strong: ['gangster', 'mafia', 'mob', 'organized crime', 'crime boss', 'drug cartel', 'drug lord', 'yakuza', 'mobster', 'crime family', 'drug trafficking', 'cartel', 'gang'],
    weak: ['drug dealer', 'drugs'],
    exclude: ['flash mob', 'angry mob', 'lynch mob', 'gang rape'],
    overview: /\bgangsters?\b|\bmafia\b|\bmob(ster)?s?\b|\bcartel\b|\bcrime boss\b/,
  },
  {
    id: 'road-trip', label: 'Road Trips & Journeys', icon: 'Map',
    strong: ['road trip', 'road movie', 'cross-country', 'journey'],
    weak: ['travel', 'trip'],
    exclude: ["hero's journey"],
    overview: /\broad trip\b|\bcross-country\b/,
  },
  {
    id: 'sports', label: 'Sports', icon: 'Trophy',
    strong: ['sports', 'sport', 'boxing', 'boxer', 'football (soccer)', 'american football', 'basketball', 'baseball', 'ice hockey', 'tennis', 'golf', 'olympic games', 'athlete', 'wrestling', 'surfing', 'sports team'],
    weak: ['coach', 'underdog', 'competition'],
    exclude: ['sports car', 'baseball bat', 'baseball stadium', 'football stadium', 'golf club', 'golf course', 'tennis court'],
    overview: /\bboxing\b|\bboxer\b|\bfootball\b|\bbasketball\b|\bbaseball\b|\bchampionship\b|\bolympic/,
  },
  {
    id: 'animals', label: 'Animals', icon: 'PawPrint', threshold: 3,
    strong: ['animal', 'animals', 'animal protagonist', 'anthropomorphic animal', 'talking animal', 'dog', 'dogs', 'stray dog', 'lost dog', 'police dog', 'k9', 'cat', 'horse', 'wildlife', 'pet', 'pets', 'anthropomorphism'],
    weak: ['wolf', 'lion', 'bear', 'fox', 'bird', 'puppy', 'fish', 'turtle', 'whale', 'dolphin', 'penguin', 'elephant', 'monkey', 'gorilla', 'tiger', 'panda', 'pig', 'rabbit', 'mouse', 'rat', 'owl', 'wolves', 'beaver', 'snail', 'hedgehog', 'sheep', 'deer', 'squirrel', 'raccoon', 'duck'],
    exclude: ['cat and mouse', 'cat burglar', 'animal mask', 'animal attack', 'animal horror', 'child killed by animal', 'killer animal', 'party animal', 'hot dog', 'trojan horse', "teacher's pet"],
  },
  {
    id: 'fairy-tales', label: 'Fairy Tales', icon: 'Sparkles',
    strong: ['fairy tale', 'based on fairy tale', 'princess', 'fairy', 'fairy godmother', 'enchanted'],
    weak: ['kingdom', 'castle', 'prince'],
    overview: /\bfairy[- ]tale\b|\bprincess\b|\benchanted\b/,
  },
  {
    id: 'found-footage', label: 'Found Footage', icon: 'Video',
    strong: ['found footage', 'mockumentary', 'camcorder', 'pov'],
    overview: /\bfound footage\b/,
  },
  {
    id: 'psychological', label: 'Psychological', icon: 'Eye',
    strong: ['psychological thriller', 'psychological horror', 'psychological', 'mental illness', 'paranoia', 'insanity', 'hallucination', 'delusion', 'schizophrenia', 'gaslighting', 'unreliable narrator', 'dissociative identity disorder', 'multiple personality'],
    weak: ['psychiatrist', 'identity crisis', 'obsession', 'manipulation', 'split personality'],
    overview: /\bpsycholog|\bparanoi|\bobsess|\bsanity\b/,
  },
  {
    id: 'courtroom', label: 'Courtroom', icon: 'Gavel', threshold: 3,
    strong: ['courtroom', 'trial', 'lawyer', 'attorney', 'court case', 'legal drama', 'jury', 'lawsuit'],
    weak: ['judge', 'justice'],
    exclude: ['district attorney', 'assistant district attorney', 'clinical trial', 'drug trial', 'trial by combat'],
    overview: /\btrial\b|\blawyers?\b|\battorneys?\b|\bcourtroom\b|\bjury\b/,
  },
  {
    id: 'racing', label: 'Cars & Racing', icon: 'Car',
    strong: ['car race', 'racing', 'street racing', 'street race', 'drag racing', 'race car', 'race car driver', 'formula 1', 'nascar', 'getaway driver'],
    weak: ['car', 'cars', 'driver', 'car chase', 'motorcycle'],
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
    strong: ['musical', 'music', 'singer', 'rock band', 'musician', 'concert', 'dancer', 'dance competition', 'ballet', 'hip-hop', 'jazz', 'broadway', 'band'],
    weak: ['dance', 'dancing'],
    exclude: ['band of misfits', 'animatronic band', 'rubber band', 'based on play or musical'],
    overview: /\bsingers?\b|\bmusicians?\b|\bband\b/,
  },
  {
    id: 'holidays', label: 'Holidays', icon: 'TreePine',
    strong: ['christmas', 'holiday', 'christmas eve', 'santa claus', 'thanksgiving', "new year's eve", 'halloween'],
    overview: /\bchristmas\b|\bsanta\b|\bthanksgiving\b|\bhalloween\b/,
  },
  {
    id: 'realities', label: 'Dreams & Other Worlds', icon: 'Infinity',
    strong: ['parallel world', 'multiverse', 'alternate reality', 'alternative reality', 'simulation', 'simulated reality', 'virtual reality', 'dream', 'dream world', 'alternate universe', 'other dimension', 'portal'],
    weak: ['fantasy world', 'secret world'],
    exclude: ['american dream', 'dream job', 'dream girl', 'dream house'],
    overview: /\bparallel (world|universe)s?\b|\bmultiverse\b|\balternate reality\b|\bsimulation\b|\bdreams?\b/,
  },
  {
    id: 'historical', label: 'Historical Epics', icon: 'Landmark',
    // TMDB's History genre and "period drama" also cover 20th-century biopics (Elvis, Michael),
    // so the genre doesn't count and "period drama" only backs up an earlier era.
    strong: ['ancient rome', 'ancient greece', 'ancient egypt', 'roman empire', 'gladiator', 'viking', 'victorian era', 'costume drama', 'historical drama', 'historical fiction', '19th century', '18th century', '17th century', '16th century', '15th century', '14th century', '13th century', '12th century', 'middle ages'],
    weak: ['medieval', 'empire', 'royalty', 'king', 'queen', 'historical', 'period drama'],
    overview: /\b1\d(th)? century\b|\bancient\b|\bmedieval\b/,
  },
  {
    id: 'prison', label: 'Prison & Escape', icon: 'LockKeyhole',
    strong: ['prison', 'prisoner', 'prison escape', 'escape from prison', 'prison cell', 'prison guard', 'prison warden', 'prison drama', 'prison camp', 'prisoner of war', 'jailbreak', 'inmate', 'death row', 'wrongful imprisonment', 'penitentiary', 'jail', 'convict', 'escaped convict'],
    weak: ['escape plan', 'ex-con', 'parole'],
    exclude: ['prisoner exchange'],
    overview: /\bprison\b|\binmates?\b|\bjail(ed|break)?\b|\bconvicts?\b/,
  },
  {
    id: 'family', label: 'Family Ties', icon: 'HouseHeart', threshold: 3,
    strong: ['dysfunctional family', 'family drama', 'family relationships', 'family conflict', 'family secret', 'family history', 'divorce', 'custody battle', 'child custody', 'single mother', 'single father', 'single parent', 'estranged father', 'estranged mother', 'family reunion', 'parenting'],
    weak: ['family', 'marriage', 'husband wife relationship', 'parents separating', 'parent child relationship', 'father son relationship', 'father daughter relationship', 'mother son relationship', 'mother daughter relationship', 'sibling relationship', 'brother brother relationship', 'sister sister relationship', 'brother sister relationship', 'grandparent grandchild relationship'],
    overview: /\bdivorc|\bestranged\b|\bcustody\b/,
  },
  {
    id: 'politics', label: 'Politics & Journalism', icon: 'Newspaper', threshold: 3,
    strong: ['politics', 'politician', 'political thriller', 'political drama', 'election', 'election campaign', 'president', 'president of the united states', 'white house', 'senator', 'prime minister', 'political corruption', 'political scandal', 'journalism', 'journalist', 'investigative journalism', 'newspaper', 'reporter', 'newsroom', 'whistleblower'],
    weak: ['conspiracy', 'corruption', 'cover-up', 'scandal', 'government'],
    overview: /\bjournalists?\b|\breporters?\b|\bpolitic(s|al|ian)\b|\belection\b|\bsenator\b/,
  },
  {
    id: 'addiction', label: 'Addiction & Recovery', icon: 'Pill', threshold: 3,
    strong: ['addiction', 'drug addiction', 'drug addict', 'alcoholism', 'alcoholic', 'heroin', 'overdose', 'rehab', 'recovering alcoholic', 'alcoholics anonymous', 'sobriety', 'relapse', 'junkie'],
    weak: ['alcohol', 'drunk', 'drinking', 'intoxication', 'drugs', 'cocaine'],
    overview: /\baddict(ion|ed|s)?\b|\balcoholi(c|sm)\b|\brehab\b|\bsobriety\b/,
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
  /** Whole keywords that never count toward the mood: idioms like "custody battle". */
  exclude?: string[];
  /** The first entry the runtime reaches applies; a negative bonus pulls long movies away. */
  runtimeBonus?: { min: number; bonus: number }[];
  threshold: number;
}

export const MOODS: MoodDef[] = [
  {
    id: 'light', label: 'Light & Fun', description: 'Easy laughs, nothing heavy', icon: 'Laugh',
    genres: { Comedy: 2, Animation: 1, Family: 1 },
    strong: ['funny', 'silly', 'slapstick', 'parody', 'spoof', 'buddy comedy', 'romantic comedy', 'action comedy', 'adventure comedy', 'satire', 'quirky', 'comedic', 'farce', 'caper'],
    // TMDB's tone words are noisy (Shawshank is "amused"), so they only back up a comedy lean.
    weak: ['lighthearted', 'light-hearted', 'hilarious', 'playful', 'whimsical', 'amused', 'cheerful', 'joyful', 'witty', 'humorous', 'mischievous', 'farcical', 'absurd', 'ridiculous'],
    negative: ['dark comedy', 'black comedy', 'tragedy', 'grief', 'death of a child'],
    excludeGenres: ['Horror', 'War'],
    // Easy viewing doesn't run past two and a half hours.
    runtimeBonus: [{ min: 150, bonus: -1 }],
    threshold: 2,
  },
  {
    id: 'feel-good', label: 'Feel-Good', description: 'Warm, uplifting, leaves you smiling', icon: 'Smile',
    // Romance only half: romantic dramas (It Ends with Us, Hamnet) are rarely feel-good.
    genres: { Family: 2, Animation: 1, Music: 1, Comedy: 1, Romance: 0.5 },
    strong: ['heartwarming', 'feel-good', 'feel good', 'uplifting', 'wholesome', 'underdog', 'triumph over adversity', 'overcoming obstacles'],
    // Tone words again only back up a lean: Oldboy and The Departed are "inspirational" on TMDB.
    weak: ['hopeful', 'inspirational', 'inspiring', 'comforting', 'sentimental', 'joyous', 'triumphant', 'optimistic', 'sweet', 'tender', 'heartfelt', 'celebratory', 'charming', 'friendship', 'family relationships', 'second chance', 'hope', 'vibrant', 'romantic comedy'],
    negative: ['bleak', 'disturbing', 'depressing', 'tragedy', 'dark comedy', 'black comedy'],
    negativeGenres: { Thriller: 1, Crime: 1, War: 1 },
    excludeGenres: ['Horror'],
    threshold: 2,
  },
  {
    id: 'edge', label: 'Edge of Your Seat', description: 'Tense, gripping, pulse-pounding', icon: 'HeartPulse',
    genres: { Thriller: 2, Horror: 2, Action: 1, Crime: 1, Mystery: 1, War: 1 },
    strong: ['suspenseful', 'tense', 'intense', 'thrilling', 'exciting', 'suspense', 'nail-biting', 'adrenaline', 'cat and mouse', 'race against time', 'high stakes', 'ticking clock', 'manhunt', 'hostage', 'chase', 'frightened', 'paranoid', 'anxious', 'frantic', 'gripping'],
    weak: ['survival', 'conspiracy', 'pursuit', 'escape', 'excited', 'exhilarated', 'aggressive', 'natural disaster', 'disaster movie'],
    negativeGenres: { Family: 1, Animation: 1 },
    threshold: 2,
  },
  {
    id: 'dark', label: 'Dark & Heavy', description: 'Bleak, haunting, hits hard', icon: 'CloudMoon',
    genres: { Horror: 1, Crime: 1, War: 1, Drama: 0.5, Thriller: 0.5 },
    strong: ['dark', 'grim', 'bleak', 'disturbing', 'depressing', 'melancholy', 'harsh', 'brutal', 'gritty', 'tragic', 'tragedy', 'nihilism', 'cruelty', 'grief', 'despair', 'sinister', 'ominous', 'gloomy', 'dread', 'gore', 'holocaust', 'sadistic', 'drug addiction', 'abuse', 'dark comedy', 'neo-noir', 'film noir', 'somber', 'harrowing', 'unsettling'],
    weak: ['death', 'murder', 'addiction', 'loss', 'suicide', 'corruption', 'violence', 'violent', 'dreary', 'body horror'],
    negative: ['lighthearted', 'whimsical', 'heartwarming', 'hilarious'],
    negativeGenres: { Family: 2, Animation: 1, Comedy: 1 },
    exclude: ['dark secret', 'dark past', 'dark horse', 'memory loss', 'fake death'],
    threshold: 2,
  },
  {
    id: 'mind-bending', label: 'Mind-Bending', description: 'Twisty, cerebral, makes you think', icon: 'Brain',
    genres: { 'Science Fiction': 1, Mystery: 1 },
    strong: ['mind-bending', 'mind bending', 'mind-blowing', 'twist', 'twist ending', 'plot twist', 'surprise ending', 'nonlinear timeline', 'non-linear narrative', 'time loop', 'surreal', 'surrealism', 'cerebral', 'thought-provoking', 'philosophical', 'parallel world', 'multiverse', 'simulation', 'simulated reality', 'memory loss', 'amnesia', 'unreliable narrator', 'paradox', 'existentialism', 'alternate reality', 'reality vs fantasy', 'consciousness', 'hallucination', 'dream', 'puzzle', 'quantum mechanics', 'time warp', 'time manipulation', 'time-manipulation', 'dissociative identity disorder', 'multiple personality'],
    weak: ['psychological', 'identity', 'time travel', 'mystery', 'baffled', 'bewildered', 'introspective', 'split personality', 'illusion', 'perspective'],
    negativeGenres: { Family: 1 },
    exclude: ['american dream', 'dream job', 'dream girl', 'secret identity', 'dual identity', 'mistaken identity', 'identity theft', 'puzzle box'],
    threshold: 2,
  },
  {
    id: 'epic', label: 'Something Epic', description: 'Big, sweeping, a proper event', icon: 'Crown',
    genres: { Adventure: 1, Fantasy: 1, War: 1, History: 1, Action: 0.5, 'Science Fiction': 0.5 },
    strong: ['epic', 'grand', 'sweeping', 'ambitious', 'saga', 'war epic', 'historical epic', 'legend', 'battle'],
    weak: ['quest', 'kingdom', 'empire', 'journey', 'awestruck', 'adventurer', 'treasure hunt', 'globetrotting'],
    negativeGenres: { Comedy: 1, Animation: 0.5, Family: 0.5 },
    exclude: ['custody battle', 'legal battle', 'rap battle', 'dance battle', 'battle of the bands', 'battle of the sexes'],
    runtimeBonus: [{ min: 150, bonus: 1.5 }, { min: 135, bonus: 1 }, { min: 120, bonus: 0.5 }],
    threshold: 2.5,
  },
  {
    id: 'moving', label: 'Moving', description: 'Heartfelt, emotional, tissues ready', icon: 'HeartCrack',
    genres: { Drama: 1, Romance: 0.5 },
    strong: ['tearjerker', 'heartbreaking', 'heart-wrenching', 'bittersweet', 'poignant', 'touching', 'sad', 'sadness', 'tears', 'melodrama', 'romantic drama', 'tragic love', 'unrequited love', 'emotional journey', 'emotional healing', 'coping with grief', 'death in family', 'death of spouse', 'death of husband', 'death of wife', 'widow', 'widower', 'terminal illness', "alzheimer's disease", "parkinson's disease", 'tragedy drama', 'poetic', 'slice of life'],
    weak: ['dramatic', 'compassionate', 'sympathetic', 'sentimental', 'wistful', 'melancholy', 'melodramatic', 'introspective', 'thoughtful', 'reflective', 'reminiscent', 'memories', 'loving', 'emotional bonding', 'human connection', 'grief', 'grieving', 'loss of loved one', 'death of a loved one', 'dying', 'dementia', 'cancer', 'trauma', 'loneliness', 'regret', 'legacy'],
    negative: ['slapstick', 'parody', 'spoof'],
    negativeGenres: { Comedy: 1, Action: 1, Thriller: 1 },
    excludeGenres: ['Horror'],
    exclude: ['dying and death'],
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
  // Only first parts of sagas the profile hasn't started; see sagas.ts.
  { id: 'saga', label: 'Start a saga', description: 'Part 1 tonight, the rest another night', icon: 'Library', maxRuntime: null },
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
