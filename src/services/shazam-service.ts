import { TpaServer, TpaSession } from '@augmentos/sdk';
import {Shazam} from 'node-shazam'

export class ShazamService {
    private shazamApi: Shazam;

    constructor() {
        this.shazamApi = new Shazam();
    }

    public async findTrack(data: string): Promise<{string, string}> {
        const song = await this.shazamApi.search_music("en-US", "GB", data, "1", "0");
        const trackName = song.tracks.hits[0].heading.title;
        const artist = song.tracks.hits[0].heading.subtitle;

        return {trackName, artist}
    }

}

const toptracks = await shazam.search_music(
    "en-US",
    "GB",
    "you know the rules and so do I",
    "1",
    "0"
  );
console.log(toptracks.tracks.hits[0].heading.title)