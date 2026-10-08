import { genreById, tagMovie } from '@curatorr/shared';
import type { StoredMovie, Store } from './store.js';

/**
 * Demo library used with --demo / CURATORR_DEMO=1 so the UI can be explored
 * without Radarr or Plex. Ratings are approximate and art is generated.
 */
type Fixture = [
  title: string,
  year: number,
  genres: string[],
  runtime: number,
  cert: string,
  rt: number | null,
  imdb: number,
  keywords: string[],
  overview: string,
];

const FIXTURES: Fixture[] = [
  ['The Dark Knight', 2008, ['Action', 'Crime', 'Drama', 'Thriller'], 152, 'PG-13', 94, 9.0, ['superhero', 'based on comic', 'vigilante', 'joker', 'dc comics', 'tense', 'dark'], 'Batman faces a chaos-loving criminal who pushes Gotham, and its masked protector, to their breaking point.'],
  ['Avengers: Endgame', 2019, ['Adventure', 'Science Fiction', 'Action'], 181, 'PG-13', 94, 8.4, ['superhero', 'marvel cinematic universe (mcu)', 'time travel', 'based on comic', 'epic', 'superhero team'], 'The surviving heroes regroup for one last, reality-bending attempt to undo a cosmic catastrophe.'],
  ['Spider-Man: Into the Spider-Verse', 2018, ['Animation', 'Action', 'Adventure', 'Science Fiction'], 117, 'PG', 97, 8.4, ['superhero', 'multiverse', 'parallel world', 'based on comic', 'teenager', 'playful'], 'A Brooklyn teen gains spider powers and teams up with spider-heroes from other dimensions.'],
  ['Logan', 2017, ['Action', 'Drama', 'Science Fiction'], 137, 'R', 93, 8.1, ['superhero', 'mutant', 'based on comic', 'road trip', 'dystopia', 'gritty', 'violence'], 'A weary, ageing mutant drives across a hostile near-future America to protect a girl with powers like his own.'],
  ['Mad Max: Fury Road', 2015, ['Action', 'Adventure', 'Science Fiction'], 120, 'R', 97, 8.1, ['post-apocalyptic future', 'dystopia', 'chase', 'desert', 'intense', 'survival'], 'In a scorched wasteland, a drifter and a rebel commander flee a tyrant in a relentless war-rig chase.'],
  ['John Wick', 2014, ['Action', 'Thriller'], 101, 'R', 86, 7.4, ['revenge', 'hitman', 'assassin', 'dog', 'violence', 'intense'], 'A retired assassin returns to the underworld he left behind after thugs take the last gift from his late wife.'],
  ['Mission: Impossible - Fallout', 2018, ['Action', 'Adventure', 'Thriller'], 147, 'PG-13', 97, 7.7, ['spy', 'espionage', 'secret agent', 'cia', 'race against time', 'suspenseful'], 'Ethan Hunt and his team race to recover stolen plutonium while being shadowed by a CIA enforcer.'],
  ['Die Hard', 1988, ['Action', 'Thriller'], 132, 'R', 94, 8.2, ['hostage', 'christmas', 'skyscraper', 'terrorist', 'police', 'suspenseful'], 'An off-duty cop fights his way through a Los Angeles tower taken over by thieves on Christmas Eve.'],
  ['The Raid', 2011, ['Action', 'Thriller', 'Crime'], 101, 'R', null, 7.6, ['martial arts', 'police', 'gang', 'violence', 'intense'], 'A SWAT team is trapped inside a tower block run by a ruthless crime lord and must fight floor by floor.'],
  ['Crouching Tiger, Hidden Dragon', 2000, ['Adventure', 'Drama', 'Action', 'Romance'], 120, 'PG-13', 98, 7.9, ['martial arts', 'wuxia', 'sword fight', 'forbidden love'], 'Two warriors pursue a stolen legendary sword and the gifted young noblewoman who took it.'],
  ['Inception', 2010, ['Action', 'Science Fiction', 'Adventure'], 148, 'PG-13', 87, 8.8, ['dream', 'heist', 'mind-bending', 'subconscious', 'complex', 'twist ending'], 'A thief who steals secrets from dreams is offered one last job: planting an idea instead.'],
  ['Interstellar', 2014, ['Adventure', 'Drama', 'Science Fiction'], 169, 'PG-13', 73, 8.7, ['space', 'astronaut', 'space travel', 'wormhole', 'father daughter relationship', 'epic', 'thought-provoking'], 'With Earth dying, a former pilot leads a mission through a wormhole in search of a new home.'],
  ['The Matrix', 1999, ['Action', 'Science Fiction'], 136, 'R', 83, 8.7, ['simulated reality', 'artificial intelligence (a.i.)', 'hacker', 'dystopia', 'martial arts', 'mind-bending'], 'A hacker discovers the world he knows is a simulation and joins the rebellion against its machine makers.'],
  ['Blade Runner 2049', 2017, ['Science Fiction', 'Drama'], 164, 'R', 88, 8.0, ['android', 'dystopia', 'neo-noir', 'artificial intelligence (a.i.)', 'cerebral', 'melancholy'], 'A replicant blade runner unearths a secret that could unravel what is left of society.'],
  ['Arrival', 2016, ['Drama', 'Science Fiction', 'Mystery'], 116, 'PG-13', 94, 7.9, ['alien', 'first contact', 'linguistics', 'nonlinear timeline', 'thought-provoking', 'grief'], 'A linguist races to understand mysterious visitors before global tensions boil over.'],
  ['Alien', 1979, ['Horror', 'Science Fiction'], 117, 'R', 93, 8.5, ['alien', 'spacecraft', 'space', 'creature', 'survival', 'suspenseful'], 'The crew of a commercial spaceship is hunted by a deadly lifeform they brought aboard.'],
  ['Back to the Future', 1985, ['Adventure', 'Comedy', 'Science Fiction'], 116, 'PG', 93, 8.5, ['time travel', 'time machine', 'teenager', 'high school', 'lighthearted'], 'A teenager accidentally travels back to 1955 and must make sure his parents fall in love.'],
  ['Ex Machina', 2015, ['Drama', 'Science Fiction'], 108, 'R', 92, 7.7, ['artificial intelligence (a.i.)', 'android', 'robot', 'psychological', 'twist ending', 'cerebral'], 'A programmer is invited to a remote estate to judge whether a humanoid AI is truly conscious.'],
  ['Edge of Tomorrow', 2014, ['Action', 'Science Fiction'], 113, 'PG-13', 91, 7.9, ['time loop', 'alien invasion', 'soldier', 'war', 'exciting'], 'An untested officer relives the same deadly battle against invaders, getting better each time.'],
  ['Dune: Part Two', 2024, ['Science Fiction', 'Adventure'], 167, 'PG-13', 92, 8.5, ['desert', 'epic', 'prophecy', 'revenge', 'war', 'space opera'], 'Paul Atreides unites with the Fremen to strike back at the empire that destroyed his family.'],
  ['Get Out', 2017, ['Mystery', 'Thriller', 'Horror'], 104, 'R', 98, 7.8, ['psychological thriller', 'hypnosis', 'satire', 'twist ending', 'suspenseful'], "A young man's weekend visit to his girlfriend's family turns into something far more sinister."],
  ['The Conjuring', 2013, ['Horror', 'Thriller'], 112, 'R', 86, 7.5, ['haunted house', 'demonic possession', 'exorcism', 'paranormal', 'based on true story', 'supernatural'], 'Paranormal investigators help a family terrorised by a dark presence in their farmhouse.'],
  ['Hereditary', 2018, ['Horror', 'Mystery', 'Thriller'], 127, 'R', 90, 7.3, ['grief', 'occult', 'supernatural', 'disturbing', 'family', 'dread', 'demon'], 'After a death in the family, a grieving household uncovers terrifying secrets about its ancestry.'],
  ['A Quiet Place', 2018, ['Horror', 'Drama', 'Science Fiction'], 91, 'PG-13', 96, 7.5, ['creature', 'survival', 'post-apocalyptic future', 'alien', 'family', 'suspenseful'], 'A family survives in silence, hiding from creatures that hunt by sound.'],
  ['Train to Busan', 2016, ['Horror', 'Thriller', 'Action'], 118, 'NR', 94, 7.6, ['zombie', 'zombie apocalypse', 'train', 'outbreak', 'survival', 'intense'], 'Passengers on a high-speed train fight for their lives as a zombie outbreak sweeps the country.'],
  ['Shaun of the Dead', 2004, ['Horror', 'Comedy'], 99, 'R', 92, 7.9, ['zombie', 'zombie apocalypse', 'friendship', 'pub', 'parody', 'hilarious'], 'A slacker tries to win back his girlfriend and save his mum during a zombie uprising.'],
  ['Scream', 1996, ['Horror', 'Mystery'], 111, 'R', 81, 7.4, ['slasher', 'masked killer', 'high school', 'whodunit', 'teenager', 'satire'], 'A masked killer who knows every horror movie rule stalks the teens of a small town.'],
  ['The Shining', 1980, ['Horror', 'Thriller'], 146, 'R', 83, 8.4, ['hotel', 'isolation', 'supernatural', 'ghost', 'insanity', 'psychological horror'], 'A writer becomes winter caretaker of an isolated hotel and slowly loses his grip on reality.'],
  ['What We Do in the Shadows', 2014, ['Comedy', 'Horror'], 86, 'R', 96, 7.7, ['vampire', 'mockumentary', 'flatmates', 'hilarious'], 'A documentary crew follows centuries-old vampire flatmates navigating modern Wellington.'],
  ['Let the Right One In', 2008, ['Drama', 'Horror', 'Romance'], 115, 'R', 98, 7.8, ['vampire', 'bullying', 'friendship', 'coming of age', 'melancholy'], 'A bullied boy forms a bond with the mysterious girl who has moved in next door.'],
  ['Paddington 2', 2017, ['Adventure', 'Comedy', 'Family'], 104, 'PG', 99, 7.8, ['talking animal', 'bear', 'heartwarming', 'prison', 'wholesome', 'whimsical'], 'Paddington takes on odd jobs to buy a special present, until it is stolen and he is framed.'],
  ['Superbad', 2007, ['Comedy'], 113, 'R', 88, 7.6, ['high school', 'teenager', 'friendship', 'party', 'coming of age', 'hilarious'], 'Two inseparable friends try to make the most of their last weeks of high school.'],
  ['The Grand Budapest Hotel', 2014, ['Comedy', 'Drama'], 100, 'R', 92, 8.1, ['hotel', 'whimsical', 'quirky', 'concierge', 'escape'], 'A legendary concierge and his lobby boy are swept into a caper over a priceless painting.'],
  ['Hot Fuzz', 2007, ['Crime', 'Action', 'Comedy'], 121, 'R', 91, 7.8, ['police', 'small town', 'buddy comedy', 'murder mystery', 'parody', 'hilarious'], "London's top cop is reassigned to a sleepy village where accidents keep happening."],
  ['Knives Out', 2019, ['Comedy', 'Crime', 'Mystery'], 130, 'PG-13', 97, 7.9, ['whodunit', 'murder mystery', 'detective', 'family', 'twist ending', 'witty'], 'A detective investigates the death of a wealthy crime novelist and his very suspicious family.'],
  ['The Princess Bride', 1987, ['Adventure', 'Family', 'Fantasy', 'Comedy', 'Romance'], 98, 'PG', 97, 8.0, ['fairy tale', 'princess', 'swashbuckler', 'true love', 'pirate', 'revenge', 'whimsical'], 'A farmhand-turned-pirate braves giants, swordsmen and royal schemers to rescue his true love.'],
  ['Groundhog Day', 1993, ['Romance', 'Fantasy', 'Drama', 'Comedy'], 101, 'PG', 94, 8.0, ['time loop', 'small town', 'falling in love', 'hilarious', 'philosophical'], 'A cynical weatherman finds himself living the same day over and over again.'],
  ['Crazy Rich Asians', 2018, ['Comedy', 'Romance', 'Drama'], 121, 'PG-13', 91, 6.9, ['romantic comedy', 'wedding', 'wealth', 'family', 'lighthearted'], "A professor travels to Singapore to meet her boyfriend's family, and learns they are astonishingly rich."],
  ["Ocean's Eleven", 2001, ['Thriller', 'Crime'], 116, 'PG-13', 83, 7.7, ['heist', 'casino', 'con artist', 'las vegas', 'robbery', 'playful'], 'A charming thief assembles a crew to rob three Las Vegas casinos in a single night.'],
  ['Baby Driver', 2017, ['Action', 'Crime'], 113, 'R', 92, 7.5, ['getaway driver', 'car chase', 'heist', 'music', 'robbery', 'exciting'], 'A young getaway driver who lives by his playlist is pulled into a doomed heist.'],
  ['Spirited Away', 2001, ['Animation', 'Family', 'Fantasy'], 125, 'PG', 96, 8.6, ['spirit', 'witch', 'magic', 'parallel world', 'coming of age', 'whimsical'], 'A girl wanders into a world of spirits and must work in a bathhouse to free her parents.'],
  ['Coco', 2017, ['Family', 'Animation', 'Fantasy', 'Music', 'Comedy', 'Adventure'], 105, 'PG', 97, 8.4, ['afterlife', 'music', 'musician', 'day of the dead', 'family relationships', 'heartwarming'], 'An aspiring musician crosses into the Land of the Dead to uncover his family history.'],
  ['Up', 2009, ['Animation', 'Comedy', 'Family', 'Adventure'], 96, 'PG', 98, 8.3, ['grief', 'talking animal', 'dog', 'old man', 'heartwarming', 'journey'], 'A widower ties thousands of balloons to his house and floats off, with a stowaway scout aboard.'],
  ['Toy Story', 1995, ['Animation', 'Adventure', 'Family', 'Comedy'], 81, 'G', 100, 8.3, ['toy', 'friendship', 'rivalry', 'heartwarming', 'playful'], "A pull-string cowboy feels threatened when a flashy space ranger becomes his kid's favourite toy."],
  ['How to Train Your Dragon', 2010, ['Fantasy', 'Adventure', 'Animation', 'Family'], 98, 'PG', 99, 8.1, ['dragon', 'viking', 'friendship', 'father son relationship', 'heartwarming'], 'A young Viking befriends the injured dragon he was supposed to slay.'],
  ['WALL-E', 2008, ['Animation', 'Family', 'Science Fiction'], 98, 'G', 95, 8.4, ['robot', 'space', 'dystopia', 'love', 'heartwarming'], 'A lonely trash-compacting robot follows a sleek probe on a journey across the galaxy.'],
  ['Finding Nemo', 2003, ['Animation', 'Family'], 100, 'G', 99, 8.2, ['fish', 'father son relationship', 'ocean', 'journey', 'talking animal', 'heartwarming'], 'An overprotective clownfish crosses the ocean to find his captured son.'],
  ['Shrek', 2001, ['Animation', 'Comedy', 'Fantasy', 'Adventure', 'Family'], 90, 'PG', 88, 7.9, ['fairy tale', 'ogre', 'princess', 'parody', 'hilarious'], 'A grumpy ogre agrees to rescue a princess so he can get his swamp back.'],
  ['The Godfather', 1972, ['Drama', 'Crime'], 175, 'R', 97, 9.2, ['mafia', 'crime family', 'organized crime', 'gangster', 'epic', 'violence'], 'The ageing patriarch of a crime dynasty hands control to his reluctant youngest son.'],
  ['Parasite', 2019, ['Comedy', 'Thriller', 'Drama'], 133, 'R', 99, 8.5, ['class differences', 'con artist', 'twist ending', 'dark comedy', 'satire', 'suspenseful'], 'A poor family schemes its way into the household of a wealthy one, with unexpected consequences.'],
  ['Se7en', 1995, ['Crime', 'Mystery', 'Thriller'], 127, 'R', 83, 8.6, ['serial killer', 'detective', 'police detective', 'dark', 'twist ending', 'disturbing'], 'Two detectives hunt a killer who stages his murders around the seven deadly sins.'],
  ['Gone Girl', 2014, ['Mystery', 'Thriller', 'Drama'], 149, 'R', 88, 8.1, ['missing person', 'marriage', 'unreliable narrator', 'twist ending', 'psychological thriller'], 'When his wife disappears, a husband becomes the prime suspect in a media frenzy.'],
  ['Prisoners', 2013, ['Drama', 'Thriller', 'Crime'], 153, 'R', 81, 8.1, ['kidnapping', 'detective', 'missing person', 'revenge', 'bleak', 'intense'], 'A desperate father takes matters into his own hands when his daughter goes missing.'],
  ['The Shawshank Redemption', 1994, ['Drama', 'Crime'], 142, 'R', 89, 9.3, ['prison', 'friendship', 'hope', 'escape', 'inspirational'], 'A banker sentenced to life finds friendship and quiet defiance over decades behind bars.'],
  ['Whiplash', 2014, ['Drama', 'Music'], 107, 'R', 94, 8.5, ['jazz', 'drummer', 'music', 'obsession', 'intense', 'mentor'], 'A young drummer is pushed to the edge by a ferociously demanding music instructor.'],
  ['Pulp Fiction', 1994, ['Thriller', 'Crime'], 154, 'R', 92, 8.9, ['hitman', 'gangster', 'nonlinear timeline', 'dark comedy', 'drugs', 'violence'], 'Hitmen, a boxer and a gangster\'s wife collide in interlocking tales of Los Angeles crime.'],
  ['Saving Private Ryan', 1998, ['Drama', 'History', 'War'], 169, 'R', 94, 8.6, ['world war ii', 'd-day', 'soldier', 'battle', 'brutal'], 'After D-Day, a squad of soldiers searches for a paratrooper whose brothers have been killed.'],
  ['1917', 2019, ['War', 'Drama'], 119, 'R', 88, 8.2, ['world war i', 'soldier', 'race against time', 'intense'], 'Two young soldiers cross enemy territory to deliver a message that could save 1,600 men.'],
  ['Gladiator', 2000, ['Action', 'Drama', 'Adventure'], 155, 'R', 80, 8.5, ['gladiator', 'roman empire', 'revenge', 'ancient rome', 'epic', 'battle'], 'A betrayed Roman general fights his way through the arena to avenge his family.'],
  ['The Lord of the Rings: The Fellowship of the Ring', 2001, ['Adventure', 'Fantasy', 'Action'], 179, 'PG-13', 92, 8.9, ['wizard', 'magic', 'elves', 'dwarf', 'quest', 'middle-earth (tolkien)', 'epic'], 'A hobbit sets out with an unlikely fellowship to destroy a ring of terrible power.'],
  ['Raiders of the Lost Ark', 1981, ['Adventure', 'Action'], 115, 'PG', 93, 8.4, ['archaeologist', 'treasure hunt', 'nazi', 'exciting', 'ancient'], 'An adventuring archaeologist races to find the Ark of the Covenant before the Nazis do.'],
  ['Pirates of the Caribbean: The Curse of the Black Pearl', 2003, ['Adventure', 'Fantasy', 'Action'], 143, 'PG-13', 80, 8.1, ['pirate', 'curse', 'treasure', 'swashbuckler', 'undead', 'playful'], 'A blacksmith teams up with an eccentric pirate to rescue a governor\'s daughter from cursed buccaneers.'],
  ['Jurassic Park', 1993, ['Adventure', 'Science Fiction'], 127, 'PG-13', 91, 8.2, ['dinosaur', 'theme park', 'genetic engineering', 'island', 'survival', 'suspenseful'], 'A theme park of cloned dinosaurs goes catastrophically wrong during a preview tour.'],
  ['Jaws', 1975, ['Horror', 'Thriller', 'Adventure'], 124, 'PG', 97, 8.1, ['shark attack', 'shark', 'beach', 'island', 'suspenseful', 'creature'], 'A police chief, a scientist and a grizzled fisherman hunt a great white terrorising a resort town.'],
  ['Rocky', 1976, ['Drama'], 120, 'PG', 93, 8.1, ['boxing', 'boxer', 'underdog', 'philadelphia', 'inspirational', 'sports'], 'A small-time boxer gets a once-in-a-lifetime shot at the heavyweight title.'],
  ['Ford v Ferrari', 2019, ['Drama', 'Action', 'History'], 152, 'PG-13', 92, 8.1, ['racing', 'race car driver', 'based on true story', 'car race', 'friendship'], 'A car designer and a hot-headed driver build a Ford to beat Ferrari at Le Mans.'],
  ['The Social Network', 2010, ['Drama'], 121, 'PG-13', 96, 7.8, ['based on true story', 'biography', 'lawsuit', 'college', 'friendship', 'computer'], 'The founding of a social network leaves its creator rich, famous and sued by his friends.'],
  ['Hidden Figures', 2016, ['Drama', 'History'], 127, 'PG', 93, 7.8, ['based on true story', 'nasa', 'space mission', 'racism', 'inspirational', 'mathematician'], 'Three brilliant Black mathematicians help NASA launch an astronaut into orbit.'],
  ['La La Land', 2016, ['Comedy', 'Drama', 'Romance', 'Music'], 128, 'PG-13', 91, 8.0, ['musical', 'jazz', 'los angeles', 'dream', 'love', 'bittersweet'], 'A jazz pianist and an aspiring actress fall in love while chasing their dreams in LA.'],
  ['Pride & Prejudice', 2005, ['Drama', 'Romance'], 129, 'PG', 87, 7.8, ['period drama', 'based on novel or book', '19th century', 'love', 'marriage', 'romance'], 'Sharp-witted Elizabeth Bennet spars with the proud, wealthy Mr Darcy.'],
  ['Before Sunrise', 1995, ['Drama', 'Romance'], 101, 'R', 100, 8.1, ['train', 'vienna', 'love at first sight', 'conversation', 'romance', 'tender'], 'Two strangers meet on a train and spend a single night walking and talking through Vienna.'],
  ['Free Solo', 2018, ['Documentary'], 100, 'PG-13', 97, 8.1, ['mountain climbing', 'rock climbing', 'biography', 'survival', 'intense'], 'A climber attempts to scale El Capitan without ropes or protection.'],
  ['Shutter Island', 2010, ['Drama', 'Thriller', 'Mystery'], 138, 'R', 68, 8.2, ['psychological thriller', 'insanity', 'twist ending', 'island', 'detective', 'mind-bending'], 'A US marshal investigates a disappearance at a hospital for the criminally insane.'],
  ['Memento', 2000, ['Mystery', 'Thriller'], 113, 'R', 93, 8.4, ['memory loss', 'nonlinear timeline', 'revenge', 'amnesia', 'twist ending', 'neo-noir'], 'A man who cannot form new memories hunts his wife\'s killer using notes and tattoos.'],
  ['Everything Everywhere All at Once', 2022, ['Action', 'Adventure', 'Science Fiction', 'Comedy'], 140, 'R', 94, 7.8, ['multiverse', 'parallel world', 'martial arts', 'mother daughter relationship', 'absurd', 'mind-bending'], 'An overwhelmed laundromat owner must connect with her parallel selves to save the multiverse.'],
  ['Home Alone', 1990, ['Comedy', 'Family'], 103, 'PG', 66, 7.7, ['christmas', 'burglar', 'home invasion', 'slapstick', 'holiday', 'family'], 'An eight-year-old left behind at Christmas defends his house against two bumbling burglars.'],
  ['Elf', 2003, ['Comedy', 'Family', 'Fantasy'], 97, 'PG', 85, 7.1, ['christmas', 'santa claus', 'elf', 'new york city', 'heartwarming', 'silly'], 'A human raised by elves at the North Pole travels to New York to find his real father.'],
  ['The Martian', 2015, ['Drama', 'Adventure', 'Science Fiction'], 144, 'PG-13', 91, 8.0, ['mars', 'stranded', 'survival', 'astronaut', 'space', 'hopeful'], 'An astronaut stranded on Mars uses his wits to survive until rescue is possible.'],
  ['Gravity', 2013, ['Science Fiction', 'Thriller', 'Drama'], 91, 'PG-13', 96, 7.7, ['space', 'astronaut', 'survival', 'space station', 'intense'], 'Two astronauts are left adrift after debris destroys their shuttle.'],
  ['Top Gun: Maverick', 2022, ['Action', 'Drama'], 131, 'PG-13', 96, 8.2, ['navy', 'fighter pilot', 'military', 'mentor', 'exciting'], 'A veteran test pilot trains a squad of young aviators for a near-impossible mission.'],
];

export function demoMovies(): StoredMovie[] {
  return FIXTURES.map(([title, year, genres, runtime, cert, rt, imdb, keywords, overview], i) => {
    const id = i + 1;
    return {
      id,
      tmdbId: 100000 + id,
      imdbId: null,
      title,
      year,
      overview,
      runtime,
      certification: cert,
      genres,
      keywords,
      ...tagMovie({ genres, keywords, overview, runtime }),
      ratings: { rt, rtVotes: null, imdb, tmdb: Math.round((imdb - 0.3) * 10) / 10, metacritic: null },
      posterUrl: `/api/demo/art/${id}/poster.svg`,
      fanartUrl: `/api/demo/art/${id}/fanart.svg`,
      posterPath: null,
      fanartPath: null,
      trailerId: null,
      plexRatingKey: null,
      plexSlug: null,
      plexGuid: null,
      addedAt: null,
    };
  });
}

export function seedDemo(store: Store) {
  const now = Date.now();
  store.replaceMovies(demoMovies(), now);
  if (store.profileRows(true).length === 0) {
    const alex = store.createLocalProfile('Alex', true);
    const sam = store.createLocalProfile('Sam', false);
    store.createLocalProfile('Kids', false, 'older_kid');
    store.replaceWatched(alex, [1, 11, 49].map((movieId) => ({ movieId, viewedAt: now })), now);
    store.replaceWatched(sam, [31, 44].map((movieId) => ({ movieId, viewedAt: now })), now);
  }
  store.set('setupComplete', true);
  store.set('sync', { at: now, movies: FIXTURES.length, matchedInPlex: 0, error: null });
}

// ---------------------------------------------------------------------------
// Generated artwork
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function wrap(text: string, max: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && (line + ' ' + word).length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.slice(0, 5);
}

export function demoArt(id: number, kind: 'poster' | 'fanart'): string | null {
  const fixture = FIXTURES[id - 1];
  if (!fixture) return null;
  const [title, year, genres] = fixture;
  const c1 = genreById.get(genres[0]!)?.color ?? '#4f46e5';
  const c2 = genreById.get(genres[1] ?? '')?.color ?? '#7c3aed';

  if (kind === 'fanart') {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720">
  <defs>
    <radialGradient id="a" cx="25%" cy="30%" r="70%"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="#0b0d17"/></radialGradient>
    <radialGradient id="b" cx="80%" cy="75%" r="55%"><stop offset="0" stop-color="${c2}" stop-opacity=".85"/><stop offset="1" stop-color="${c2}" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1280" height="720" fill="url(#a)"/>
  <rect width="1280" height="720" fill="url(#b)"/>
  <text x="1220" y="660" text-anchor="end" font-family="Inter,Arial,sans-serif" font-size="120" font-weight="800" fill="#fff" fill-opacity=".08">${year}</text>
</svg>`;
  }

  const lines = wrap(title.toUpperCase(), 13);
  const lineHeight = 58;
  const startY = 470 - ((lines.length - 1) * lineHeight) / 2;
  const tspans = lines
    .map((l, i) => `<tspan x="250" y="${startY + i * lineHeight}">${esc(l)}</tspan>`)
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" width="500" height="750">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>
    <linearGradient id="s" x1="0" y1="0" x2="0" y2="1"><stop offset=".35" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".75"/></linearGradient>
  </defs>
  <rect width="500" height="750" fill="url(#g)"/>
  <circle cx="380" cy="170" r="190" fill="#fff" fill-opacity=".08"/>
  <circle cx="110" cy="260" r="120" fill="#fff" fill-opacity=".05"/>
  <rect width="500" height="750" fill="url(#s)"/>
  <text font-family="Inter,Arial,sans-serif" font-size="50" font-weight="800" fill="#fff" text-anchor="middle" letter-spacing="1">${tspans}</text>
  <text x="250" y="${startY + lines.length * lineHeight + 10}" font-family="Inter,Arial,sans-serif" font-size="26" fill="#fff" fill-opacity=".75" text-anchor="middle">${year}</text>
  <text x="250" y="715" font-family="Inter,Arial,sans-serif" font-size="16" letter-spacing="4" fill="#fff" fill-opacity=".45" text-anchor="middle">CURATORR DEMO</text>
</svg>`;
}
