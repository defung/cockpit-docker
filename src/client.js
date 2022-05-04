import rest from './rest.js';

const DOCKER_SYSTEM_ADDRESS = "/var/run/docker.sock";
export const VERSION = "/v1.12/";

export function getAddress(system) {
    return (DOCKER_SYSTEM_ADDRESS);
}

function podmanCall(name, method, args, system, body) {
    const options = {
        method: method,
        path: VERSION + name,
        body: body || "",
        params: args,
    };

    return rest.call(getAddress(system), system, options);
}

function podmanMonitor(name, method, args, callback, system) {
    const options = {
        method: method,
        path: VERSION + name,
        body: "",
        params: args,
    };

    const connection = rest.connect(getAddress(system), system);
    return connection.monitor(options, callback, system);
}

export function streamEvents(system, callback) {
    return new Promise((resolve, reject) => {
        podmanMonitor("events", "GET", {}, callback, system)
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function getInfo(system) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("timeout")), 5000);
        podmanCall("info", "GET", {}, system)
                .then(reply => {
                    const resp = JSON.parse(reply);
                    resp.version = {
                        Version: resp.ServerVersion
                    };
                    resp.registries = resp.RegistryConfig.IndexConfigs;
                    resp.host = {
                        cgroupVersion: resp.CgroupVersion
                    };
                    return resolve(resp);
                })
                .catch(reject)
                .finally(() => clearTimeout(timeout));
    });
}

export function getContainers(system, id) {
    return new Promise((resolve, reject) => {
        const options = { all: true };
        if (id)
            options.filters = JSON.stringify({ id: [id] });

        podmanCall("containers/json", "GET", options, system)
                .then(reply => {
                    const json = JSON.parse(reply);
                    console.log(json);
                    json.map(j => {
                        j.command = j.command.split(" ");
                        return j;
                    });
                    return resolve(json);
                })
                .catch(reject);
    });
}

export function getContainerStats(system, callback) {
    return new Promise((resolve, reject) => {
        const options = {
            stream: true,
        };
        podmanMonitor("containers/stats", "GET", options, callback, system)
                .then(resolve, reject);
    });
}

export function getDockerContainerStats(system, id, callback) {
    return new Promise((resolve, reject) => {
        const options = {
            stream: true,
        };
        podmanMonitor("containers/" + id + "/stats", "GET", options, callback, system)
                .then(resolve, reject);
    });
}

export function inspectContainer(system, id) {
    return new Promise((resolve, reject) => {
        const options = {
            size: false // set true to display filesystem usage
        };
        podmanCall("containers/" + id + "/json", "GET", options, system)
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function delContainer(system, id, force) {
    return new Promise((resolve, reject) => {
        const options = {
            force: force,
        };
        podmanCall("containers/" + id, "DELETE", options, system)
                .then(resolve)
                .catch(reject);
    });
}

export function createContainer(system, config) {
    return new Promise((resolve, reject) => {
        podmanCall("containers/create", "POST", {}, system, JSON.stringify(config))
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function commitContainer(system, commitData) {
    return new Promise((resolve, reject) => {
        podmanCall("commit", "POST", commitData, system)
                .then(resolve)
                .catch(reject);
    });
}

export function postContainer(system, action, id, args) {
    return new Promise((resolve, reject) => {
        podmanCall("containers/" + id + "/" + action, "POST", args, system)
                .then(resolve)
                .catch(reject);
    });
}

export function postPod(system, action, id, args) {
    return new Promise((resolve, reject) => {
        podmanCall("libpod/pods/" + id + "/" + action, "POST", args, system)
                .then(resolve)
                .catch(reject);
    });
}

export function delPod(system, id, force) {
    return new Promise((resolve, reject) => {
        const options = {
            force: force,
        };
        podmanCall("libpod/pods/" + id, "DELETE", options, system)
                .then(resolve)
                .catch(reject);
    });
}

export function execContainer(system, id) {
    const args = {
        AttachStderr: true,
        AttachStdout: true,
        AttachStdin: true,
        Tty: true,
        Cmd: ["/bin/sh"],
    };

    return new Promise((resolve, reject) => {
        podmanCall("containers/" + id + "/exec", "POST", {}, system, JSON.stringify(args))
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function resizeContainersTTY(system, id, exec, width, height) {
    const args = {
        h: height,
        w: width,
    };

    let point = "containers/";
    if (!exec)
        point = "exec/";

    return new Promise((resolve, reject) => {
        podmanCall(point + id + "/resize", "POST", args, system)
                .then(resolve)
                .catch(reject);
    });
}

function parseImageInfo(info) {
    const image = {};

    if (info.Config) {
        image.Entrypoint = info.Config.Entrypoint;
        image.Command = info.Config.Cmd;
        image.Ports = Object.keys(info.Config.ExposedPorts || {});
    }
    image.Author = info.Author;

    return image;
}

export function getImages(system, id) {
    return new Promise((resolve, reject) => {
        const options = {};
        if (id)
            options.filters = JSON.stringify({ id: [id] });
        podmanCall("images/json", "GET", options, system)
                .then(reply => {
                    const immages = JSON.parse(reply);
                    const images = {};
                    const promises = [];

                    for (const image of immages || []) {
                        images[image.Id] = image;
                        promises.push(podmanCall("images/" + image.Id + "/json", "GET", {}, system));
                    }

                    Promise.all(promises)
                            .then(replies => {
                                for (const reply of replies) {
                                    const info = JSON.parse(reply);
                                    images[info.Id] = Object.assign(images[info.Id], parseImageInfo(info));
                                    images[info.Id].isSystem = system;
                                }
                                resolve(images);
                            })
                            .catch(reject);
                })
                .catch(reject);
    });
}

export function getPods(system, id) {
    return new Promise((resolve, reject) => {
        const options = {};
        if (id)
            options.filters = JSON.stringify({ id: [id] });
        podmanCall("libpod/pods/json", "GET", options, system)
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function delImage(system, id, force) {
    return new Promise((resolve, reject) => {
        const options = {
            force: force,
        };
        podmanCall("images/" + id, "DELETE", options, system)
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function untagImage(system, id, repo, tag) {
    return new Promise((resolve, reject) => {
        const options = {
            repo: repo,
            tag: tag
        };
        podmanCall("images/" + id + "/untag", "POST", options, system)
                .then(resolve)
                .catch(reject);
    });
}

export function pullImage(system, reference) {
    return new Promise((resolve, reject) => {
        const options = {
            reference: reference,
        };
        podmanCall("images/pull", "POST", options, system)
                .then(r => {
                    // Need to check the last response if it contains error
                    const responses = r.trim().split("\n");
                    const response = JSON.parse(responses[responses.length - 1]);
                    if (response.error) {
                        response.message = response.error;
                        reject(response);
                    } else if (response.cause) // present for 400 and 500 errors
                        reject(response);
                    else
                        resolve();
                })
                .catch(reject);
    });
}

export function pruneUnusedImages(system) {
    return new Promise((resolve, reject) => {
        podmanCall("images/prune?all=true", "POST", {}, system).then(resolve)
                .then(reply => resolve(JSON.parse(reply)))
                .catch(reject);
    });
}

export function imageExists(system, id) {
    return podmanCall("images/" + id + "/exists", "GET", {}, system);
}
