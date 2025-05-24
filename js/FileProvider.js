import { Lemmings } from './LemmingsNamespace.js';

class FileProvider {
        constructor(rootPath) {
            this.rootPath = rootPath;
            this.log = new Lemmings.LogHandler("FileProvider");
        }
        /** load binary data from URL: rootPath + [path] + filename */
        loadBinary(path, filename = null) {
            let url = this.rootPath + path + ((filename == null) ? "" : "/" + filename);
            this.log.debug("loading:" + url);
            return new Promise((resolve, reject) => {
                var xhr = new XMLHttpRequest();
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        let reader = new Lemmings.BinaryReader(xhr.response, 0, null, this.filenameFormUrl(url), path);
                        resolve(reader);
                    } else {
                        this.log.log("error load file:" + url);
                        reject({
                            status: xhr.status,
                            statusText: xhr.statusText
                        });
                    }
                };
                xhr.onerror = () => {
                    this.log.log("error load file:" + url);
                    reject({
                        status: xhr.status,
                        statusText: xhr.statusText
                    });
                };
                xhr.open("GET", url);
                xhr.responseType = "arraybuffer";
                xhr.send();
            });
        }
        /** load string data from URL */
        loadString(url) {
            this.log.log("Load file as string: " + url);
            return new Promise((resolve, reject) => {
                let xhr = new XMLHttpRequest();
                xhr.onload = (oEvent) => {
                    resolve(xhr.response);
                };
                xhr.onerror = () => {
                    this.log.log("error load file:" + url);
                    reject({
                        status: xhr.status,
                        statusText: xhr.statusText
                    });
                };
                /// setup query
                xhr.open('GET', url, true);
                xhr.responseType = "text";
                /// call url
                xhr.send(null);
            });
        }
        // Extract filename form URL
        filenameFormUrl(url) {
            if (url == "")
                return "";
            url = url.substring(0, (url.indexOf("#") == -1) ? url.length : url.indexOf("#"));
            url = url.substring(0, (url.indexOf("?") == -1) ? url.length : url.indexOf("?"));
            url = url.substring(url.lastIndexOf("/") + 1, url.length);
            return url;
        }
    }
    Lemmings.FileProvider = FileProvider;

export { FileProvider };
