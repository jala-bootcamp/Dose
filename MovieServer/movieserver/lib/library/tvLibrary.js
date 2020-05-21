const Library = require('./library');
const pathLib = require('path');
const SerieMetadata = require('../metadata/tvMetadata');
const db = require('../db');
var AsyncLock = require('async-lock');

const MOVIE_FORMATS = [
    'mp4', 'ts', 'mkv', 'webm', 'avi'
];
const SUB_FORMATS = [
    'srt', 'vtt', 'sub'
]

class TvLibrary extends Library {

    /**
     * Creates a new instance of a TV library
     * 
     * @param {String} name - The name of the library
     * @param {String} path - The path of the library
     * @param {String} id - The id of the library
     * 
     */
    constructor(name, path, id) {
        super(name, path, id, new SerieMetadata());
        this.lock = new AsyncLock();
    }

    getType() {
        return 'SERIES';
    }

    checkIfSerie(path) {
        return !(path.includes('\\') || path.includes('//'))
    }

    addSerieIfNotSaved(serieName, path) {
        return new Promise(async (resolve, reject) => {
            await db.tx(async t => {
                // Check if we have already saved this show
                let result = await t.any('SELECT * FROM serie WHERE path = $1 AND library = $2', [path, this.id]);
                // If we haven't saved this show, insert it
                if (result.length === 0) {
                    console.log(` > Found a new serie (${path} for library: '${this.name}')`);
                    // Insert to the serie table (contining the path of the serie)
                    await t.none('INSERT INTO serie (path, library, name) VALUES ($1, $2, $3)', [path, this.id, serieName]);
                    // Get the internal ID for the new show
                    result = await t.one('SELECT id FROM serie WHERE path = $1 AND library = $2', [path, this.id]);
                    let internalSerieID = result.id;

                    // Get the metadata for the show
                    this.metadata.getShowMetadata(serieName).then(result => {
                        let metadata = result.metadata;
                        let images = result.images;
                        let trailer = result.trailer;

                        // If we didn't find any metadata, insert dummy metadata
                        if (metadata === null) {
                            console.log(` > Couldn't find any metadata for serie '${serieName}'`);
                            images = {
                                backdrops: [],
                                posters: []
                            }
                            metadata = this.metadata.getDummyMetadata(serieName);
                            trailer = "";
                            
                            this.metadata.insertShowMetadata(metadata, images, trailer, internalSerieID).then(() => {
                                resolve();
                            });
                        } else {
                            // If we found metadata, save it
                            console.log(` > Saving metadata for serie '${serieName}'`);
                            // Insert metadata
                            this.metadata.insertShowMetadata(metadata, images, trailer, internalSerieID).then(() => {
                                resolve();
                            });
                        }
                    });
                } else {
                    resolve();
                }
                return;
            });
        });
    }

    async addSeasonIfNotSaved(serieName, seasonPath, showPath, seasonNumber) {
        return new Promise(async (resolve, reject) => {
            await db.tx(async t => {
                // Check if we have already saved this season for the show
                let result = await t.any('SELECT * FROM serie_season WHERE season_number = $1 AND serie_id IN (SELECT id FROM serie WHERE name = $2 AND path = $3)', [seasonNumber, serieName, showPath]);
                // If we don't have it saved, save it to the database
                if (result.length === 0) {
                    console.log(` > Found a new season (${seasonNumber}) for the show ${serieName} in library ${this.name}`);
                    await t.none('INSERT INTO serie_season (serie_id, season_number, path) VALUES ((SELECT id FROM serie WHERE name = $1 AND path = $2), $3, $4) ', [serieName, showPath, seasonNumber, seasonPath]);


                    // Get the Tmdb id for the show
                    let serieTmdbId = await t.one('SELECT tmdb_id FROM serie_metadata WHERE serie_id IN (SELECT id FROM serie WHERE name = $1 AND path = $2)', [serieName, showPath], c => +c.tmdb_id);
                    // Get the internal ID for the show
                    let internalSerieID = await t.one(`SELECT id FROM serie WHERE name = $1 AND path = $2`, [serieName, showPath], c => +c.id);

                    // Get the metadata for this season
                    this.metadata.getSeasonMetadata(serieTmdbId, seasonNumber).then(async (result) => {
                        let metadata = result.metadata;

                        // If we didn't find any metadata, save dummymetadata
                        if (metadata === null) {
                            console.log(` > Couldn't find any metadata for season ${seasonNumber} of serie ${serieName}`);
                             resolve();
                            // TODO: GET AND SAVE DUMMYDATA
                        } else {
                            // If we found metadata, save it to the database
                            console.log(` > Saving metadata for season ${seasonNumber} of serie ${serieName}`);
                            this.metadata.insertSeasonMetadata(metadata, internalSerieID, seasonNumber).then(() => {
                                resolve();
                            });
                        }
                    });
                } else {
                    resolve();
                }
            });
        });
    }

    addEpisodeIfNotSaved(serieName, episodePath, showPath, seasonNumber, episodeNumber) {
        return new Promise(async (resolve, reject) => {
            await db.tx(async t => {
                let result = await t.any('SELECT * FROM serie_episode WHERE season_number = $1 AND episode = $2 AND serie_id IN (SELECT id FROM serie WHERE name = $3 AND path = $4)', [seasonNumber, episodeNumber, serieName, showPath]);
                if (result.length === 0) {
                    console.log(` > Found a new episode (Season ${seasonNumber} episode ${episodeNumber}) for the show ${serieName} in library ${this.name}`);
                    await t.none('INSERT INTO serie_episode (season_number, serie_id, episode, path) VALUES ($1, (SELECT id FROM serie WHERE name = $2 AND path = $3), $4, $5)', [seasonNumber, serieName, showPath, episodeNumber, episodePath]);

                    // Get the internal serie id for the episode
                    let internalSerieID = await t.one(`SELECT id FROM serie WHERE name = $1 AND path = $2`, [serieName, showPath], c => +c.id);
                    // Get the Tmdb id for the show
                    let serieTmdbId = await t.one('SELECT tmdb_id FROM serie_metadata WHERE serie_id IN (SELECT id FROM serie WHERE name = $1 AND path = $2)', [serieName, showPath], c => +c.tmdb_id);
                    this.metadata.getEpisodeMetadata(serieTmdbId, seasonNumber, episodeNumber).then(result => {
                        let metadata = result.metadata;

                        if (metadata === null) {
                            console.log(` > Couldn't find any metadata for season ${seasonNumber} episode ${episodeNumber} of serie ${serieName}`);
                            // TODO: GET AND SAVE DUMMYDATA
                            resolve();
                        } else {
                            console.log(` > Saving metadata for season ${seasonNumber} episode ${episodeNumber} of serie ${serieName}`);
                            this.metadata.insertEpisodeMetadata(metadata, internalSerieID, seasonNumber, episodeNumber).then(() => {
                                resolve();
                            });
                        }
                    });

                } else {
                    resolve();
                }
            });
        });
    }

    /**
     * Tries to parse the path and get the season number.
     * Returns the seasonNumber or false if it couldn't parse it
     * @param {string} path 
     */
    getSeasonNumber(path) {
        let dirname = pathLib.dirname(path);
        dirname = dirname.substring(dirname.indexOf("/") + 1);
        dirname = dirname.substring(dirname.indexOf("\\") + 1);
        let seasonNumber = dirname.replace( /^\D+/g, '')
        seasonNumber = parseInt(seasonNumber);
        return !Number.isNaN(seasonNumber) ? seasonNumber : false
    }

    /**
     * Tries to get the showname for a path.
     * 
     * @param {string} path 
     */
    getShowName(path) {
        let dirname = pathLib.dirname(path);
        let outerDirname = pathLib.dirname(dirname);
        outerDirname = outerDirname.substring(outerDirname.indexOf("/") + 1);
        outerDirname = outerDirname.substring(outerDirname.indexOf("\\") + 1);
        return this.nameMatch(outerDirname);
    }

    /**
     * Returns the showpath
     * @param {string} path 
     */
    getShowPath(path) {
        let dirname = pathLib.dirname(path);
        let outerDirname = pathLib.dirname(dirname);
        return outerDirname;
    }

    /**
     * Returns the seasonpath
     * @param {string} path 
     */
    getSeasonPath(path) {
        return pathLib.dirname(path);
    }

    /**
     * Tries to parse the episode number.
     * Returns the episode number or false if it couldn't parse it
     * @param {string} path 
     */
    getEpisodeNumber(path) {
        let filename = path.replace(/^.*[\\\/]/, '')

        let re = new RegExp("[S|s]\\d+[E|e](\\d+)", 'gm');
        let matches = re.exec(filename);
        if (matches != null && matches.length >= 2) {
            return matches[1];
        } else {
            re = new RegExp("\\d+x(\\d+)", 'gm');
            matches = re.exec(filename);
            if (matches != null && matches.length >= 2) {
                return matches[1];
            } else {
                return false;
            }
        }
    }

    async newEntry(path) {
        return new Promise(async (resolve, reject) => {

            let fileExtension = path.substring(path.lastIndexOf('.') + 1);
            if (!MOVIE_FORMATS.includes(fileExtension) && !SUB_FORMATS.includes(fileExtension)) {
                console.log("\x1b[33m", `> ${path} is not a supported format.`, "\x1b[0m");
                resolve();
                return;
            }

            let t = this;
            // Lock so each library only can handle one serie at a time (for race condition with episodes)
            this.lock.acquire(this.id, async function(done) {
                let seasonNumber = t.getSeasonNumber(path);
                let episodeNumber = t.getEpisodeNumber(path);

                if (seasonNumber === false) {
                    console.log(`> Couldn't find a season number for ${path} (${seasonNumber}). Stopping.`);
                } else if (episodeNumber === false) {
                    console.log(`> Couldn't find a episode number for ${path}, Stopping.`);
                } else {
                    episodeNumber = parseInt(episodeNumber);
                    let showName = t.getShowName(path);
                    let showPath = t.getShowPath(path);
                    let seasonPath = t.getSeasonPath(path);            
                    await t.addSerieIfNotSaved(showName, showPath);
                    await t.addSeasonIfNotSaved(showName, seasonPath, showPath, seasonNumber);
                    await t.addEpisodeIfNotSaved(showName, path, showPath, seasonNumber, episodeNumber);
                }
                done();
            }, function() {
                resolve();
            });
        });
    }

    async removeEntry(path) {
        return new Promise(async (resolve, reject) => {
            let t = this;
            this.lock.acquire(this.id, async function(done) {
                db.any('SELECT * FROM serie_episode WHERE path = $1', [path]).then(async (episodeInformation) => {
                    if (episodeInformation.length > 0) {
                        console.log(` > Removing episode ${episodeInformation[0].episode} in season ${episodeInformation[0].season_number} for serie with ID ${episodeInformation[0].serie_id}`);
                        // Remove the episode
                        await db.none('DELETE FROM serie_episode WHERE path = $1', [path]);
                        // Remove the episodes metadata
                        await db.none('DELETE FROM serie_episode_metadata WHERE season_number = $1 AND serie_id = $2 AND episode_number = $3', [episodeInformation[0].season_number, episodeInformation[0].serie_id, episodeInformation[0].episode]);

                        // Check if there are no more episodes saved in the database after we removed this one, if that is the case: Remove the season from the database
                        db.any('SELECT * FROM serie_episode WHERE serie_id = $1 AND season_number = $2', [episodeInformation[0].serie_id, episodeInformation[0].season_number]).then(async (result) => {
                            if (result.length === 0) {
                                console.log(` > No more saved episodes in season ${episodeInformation[0].season_number} for serie ${episodeInformation[0].serie_id}, removing the season from the database.`);

                                // Remove the season
                                await db.none('DELETE FROM serie_season WHERE serie_id = $1 AND season_number = $2', [episodeInformation[0].serie_id, episodeInformation[0].season_number]);
                                await db.none('DELETE FROM serie_season_metadata WHERE serie_id = $1 AND season_id = $2', [episodeInformation[0].serie_id, episodeInformation[0].season_number]);
                                
                                // Check if there are no more seasons saved in the database after we removed the season, if that is the case: Remove the serie from the database
                                db.any('SELECT * FROM serie_season WHERE serie_id = $1', [episodeInformation[0].serie_id]).then(async (result) => {
                                    if (result.length === 0) {
                                        console.log(` > No more seasons in the show ${episodeInformation[0].serie_id}, removing the show from the database.`);

                                        // Remove the serie
                                        await db.none('DELETE FROM serie WHERE id = $1', [episodeInformation[0].serie_id]);
                                        await db.none('DELETE FROM serie_metadata WHERE serie_id = $1', [episodeInformation[0].serie_id]);
                                    }
                                    done();
                                });
                            } else {
                                done();
                            }
                        });
                    } else {
                        done();
                    }
                });
            }, function() {
                resolve();
            });
        });
    }
}

module.exports = TvLibrary;