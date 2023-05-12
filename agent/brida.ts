// Definitions

let keystoreList: any[] = [];
let callbackG: any = null;
let authenticationResultInst: any = null;

/*
    Brida Functions
*/
function getallclasses() {
    let result = []
    if (ObjC.available) {
        for (let className in ObjC.classes) {
            if (ObjC.classes.hasOwnProperty(className)) {
                result.push(className);
            }
        }
    } else if (Java.available) {
        Java.perform(function () {
            Java.enumerateLoadedClasses({
                onMatch: function (className) {
                    result.push(className);
                },
                onComplete: function () {
                }
            });
        });
    }
    return result;
}

function getallmodules() {
    let results: {
        [key: string]: any
    } = {};
    Process.enumerateModules().forEach((module: Module) => {
        results[module.name] = module.base;
    });
    return results;
}

function getmoduleimports(importname: string) {
    let results: {
        [key: string]: any
    } = {};
    Process.enumerateModules().forEach((module: Module) => {
        module.enumerateImports().forEach((moduleImports: ModuleImportDetails) => {
            if (module.name === importname) {
                results[moduleImports.type!! + ": " + moduleImports.name] = moduleImports.address;
            }
        })
    });
    return results;
}

function getmoduleexports(importname: string) {
    let results: {
        [key: string]: any
    } = {};
    Process.enumerateModules().forEach((module: Module) => {
        module.enumerateExports().forEach((moduleExports: ModuleExportDetails) => {
            if (module.name === importname) {
                results[moduleExports.type + ": " + moduleExports.name] = moduleExports.address;
            }
        })
    });
    return results;
}

function getclassmethods(classname: string) {
    let results: {
        [key: string | number]: any
    } | undefined = {};
    if (ObjC.available) {
        let resolver = new ApiResolver("objc");
        resolver.enumerateMatches("*[" + classname + " *]").forEach((apiResolverMatch: ApiResolverMatch) => {
            results!![apiResolverMatch.name] = apiResolverMatch.address;
        });
    } else if (Java.available) {
        Java.perform(function () {
            results = getJavaMethodArgumentTypes(classname);
        });
    }
    return results;
}

/*
This method is used to get Java methods with arguments in bytecode syntex. By simply calling the getDeclaredMethods of a Java Class object
and then calling toString on each Method object we do not get types in bytecode format. For example we get 'byte[]' instead of
'[B'. This function uses overload object of frida to get types in correct bytecode form.
*/
function getJavaMethodArgumentTypes(classname: any) {
    if (Java.available) {
        let results: {
            [key: string]: any
        } = {};
        Java.perform(function () {
            let hook = Java.use(classname);
            let res = hook.class.getDeclaredMethods();
            res.forEach(function (s: { toString: () => any; }) {
                let targetClassMethod = parseJavaMethod(s.toString());
                let delim = targetClassMethod.lastIndexOf(".");
                if (delim === -1) return;
                let targetClass = targetClassMethod.slice(0, delim)
                let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length)

                let hookClass = Java.use(targetClass);
                let classMethodOverloads = hookClass[targetMethod].overloads;
                classMethodOverloads.forEach(function (cmo: { argumentTypes: any; returnType: { className: any; }; }) {
                    // overload.argumentTypes is an array of objects representing the arguments. In the "className" field of each object there
                    // is the bytecode form of the class of the current argument
                    let argumentTypes = cmo.argumentTypes;
                    let argumentTypesArray: any[] = []
                    argumentTypes.forEach(function (cmo: { className: any; }) {
                        argumentTypesArray.push(cmo.className);
                    });
                    let argumentTypesString = argumentTypesArray.toString();
                    // overload.returnType.className contain the bytecode form of the class of the return value
                    let currentReturnType = cmo.returnType.className;
                    let newPattern = currentReturnType + " " + targetClassMethod + "(" + argumentTypesString + ")";
                    results[newPattern] = 0;
                });
                hookClass.$dispose;
            });
            hook.$dispose;
        });
        return results;
    }
}

/*
INPUT LIKE: public boolean a.b.functionName(java.lang.String)
OUTPUT LIKE: a.b.functionName
*/
function parseJavaMethod(method: string) {
    let parSplit = method.split("(");
    let spaceSplit = parSplit[0].split(" ");
    return spaceSplit[spaceSplit.length - 1];
}


function getplatform() {
    if (Java.available) {
        return 0;
    } else if (ObjC.available) {
        return 1;
    } else {
        return 2;
    }
}

//INPUT LIKE: public boolean a.b.functionName(java.lang.String,java.lang.String)
//OUTPUT LIKE: ["java.lang.String","java.lang.String"]
function getJavaMethodArguments(method: any) {
    let m = method.match(/.*\((.*)\).*/);
    if (m[1] !== "") {
        return m[1].split(",");
    } else {
        return [];
    }
}


// remove duplicates from array
function uniqBy(array: any, key: any) {
    let seen: {
        [key: string | number]: any
    } = {};
    return array.filter(function (item: any) {
        let k = key(item);
        return seen.hasOwnProperty(k) ? false : (seen[k] = true);
    });
}

// print helper
function printArg(desc: any, arg: any) {
    if (arg != 0x0) {
        try {
            let objectArg = new ObjC.Object(arg);
            console.log("\t(" + objectArg.$className + ") " + desc + objectArg.toString());
        } catch (err2) {
            console.log("\t" + desc + arg);
        }
    } else {
        console.log("\t" + desc + "0x0");
    }
}

// trace Module functions
function traceModule(impl: any, name: any, backtrace: any) {
    console.log("*** Tracing " + name);
    Interceptor.attach(impl, {
        onEnter: function (args) {
            console.log("*** entered " + name);
            if (backtrace === "true") {
                console.log("Backtrace:\n\t" + Thread.backtrace(this.context, Backtracer.ACCURATE).map(DebugSymbol.fromAddress).join("\n\t"));
            }
        },
        onLeave: function (retval) {
            console.log("*** exiting " + name);
            console.log("Return value:");
            if (ObjC.available) {
                printArg("retval: ", retval);
            } else {
                console.log("\tretval: ", retval);
            }
        }
    });
}

// trace a specific Java Method
function traceJavaMethod(pattern: any, backtrace: any) {
    let targetClassMethod = parseJavaMethod(pattern);
    let argsTargetClassMethod = getJavaMethodArguments(pattern);
    let delim = targetClassMethod.lastIndexOf(".");
    if (delim === -1) return;
    let targetClass = targetClassMethod.slice(0, delim)
    let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length)
    let hook = Java.use(targetClass);
    console.log("*** Tracing " + pattern);
    hook[targetMethod].overload.apply(hook[targetMethod], argsTargetClassMethod).implementation = function () {
        console.log("*** entered " + targetClassMethod);
        // print args
        if (arguments.length) console.log("Parameters:");
        for (let j = 0; j < arguments.length; j++) {
            console.log("\targ[" + j + "]: " + arguments[j]);
        }
        // print backtrace
        if (backtrace === "true") {
            Java.perform(function () {
                let threadClass = Java.use("java.lang.Thread");
                let currentThread = threadClass.currentThread();
                let currentStackTrace = currentThread.getStackTrace();
                console.log("Backtrace:");
                currentStackTrace.forEach(function (st: any) {
                    console.log("\t" + st.toString());
                });
            });
        }
        // print retval
        let retval = this[targetMethod].apply(this, arguments);
        console.log("*** exiting " + targetClassMethod);
        console.log("Return value:");
        console.log("\tretval: " + retval);
        return retval;
    }
}

// trace ObjC methods
function traceObjC(impl: any, name: any, backtrace: any) {
    console.log("*** Tracing " + name);
    Interceptor.attach(impl, {
        onEnter: function (args) {
            console.log("*** entered " + name);
            console.log("Caller: " + DebugSymbol.fromAddress(this.returnAddress));
            // print args
            if (name.indexOf(":") !== -1) {
                console.log("Parameters:");
                let par = name.split(":");
                par[0] = par[0].split(" ")[1];
                for (let i = 0; i < par.length - 1; i++) {
                    printArg(par[i] + ": ", args[i + 2]);
                }
            }
            if (backtrace === "true") {
                console.log("Backtrace:\n\t" + Thread.backtrace(this.context, Backtracer.ACCURATE)
                    .map(DebugSymbol.fromAddress).join("\n\t"));
            }
        },
        onLeave: function (retval) {
            console.log("*** exiting " + name);
            console.log("Return value:");
            printArg("retval: ", retval);
        }
    });
}


function changeReturnValueAndroid(pattern: any, type: any, typeret: any, newret: any) {
    if (type === "java_method") {
        let targetClassMethod = parseJavaMethod(pattern);
        let argsTargetClassMethod = getJavaMethodArguments(pattern);
        let delim = targetClassMethod.lastIndexOf(".");
        if (delim === -1) return;
        let targetClass = targetClassMethod.slice(0, delim)
        let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length)
        let hook = Java.use(targetClass);
        hook[targetMethod].overload.apply(hook[targetMethod], argsTargetClassMethod).implementation = function () {
            let retval = this[targetMethod].apply(this, arguments);
            let toRet = newret;
            if (typeret === "String") {
                let stringClass = Java.use("java.lang.String");
                toRet = stringClass.$new(newret);
            } else if (typeret === "Ptr") {
                toRet = ptr(newret);
            } else if (typeret === "Boolean") {
                toRet = newret === "true";
            }
            console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
            return toRet;
        }
        // SINGLE EXPORT
    } else {
        let res = new ApiResolver("module");
        pattern = "exports:" + pattern;
        let matches = res.enumerateMatches(pattern);
        let targets = uniqBy(matches, JSON.stringify);
        targets.forEach(function (target: any) {
            Interceptor.attach(target.address, {
                onEnter: function (args) {
                },
                onLeave: function (retval) {
                    let toRet = newret;
                    if (typeret === "String") {
                        let stringClass = Java.use("java.lang.String");
                        toRet = stringClass.$new(newret);
                    } else if (typeret === "ptr") {
                        toRet = ptr(newret);
                    } else if (typeret === "Boolean") {
                        if (newret === "true") {
                            toRet = 1;
                        } else {
                            toRet = 0;
                        }
                        console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                        retval.replace(toRet);
                    }
                    console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                    retval.replace(toRet);
                }
            });
        });
    }
    console.log("*** Replacing return value of " + pattern + " with " + newret);
}

function changeReturnValueGeneric(pattern: any, type: any, typeret: any, newret: any) {
    let res = new ApiResolver("module");
    pattern = "exports:" + pattern;
    let matches = res.enumerateMatches(pattern);
    let targets = uniqBy(matches, JSON.stringify);
    targets.forEach((target: any) => {
        Interceptor.attach(target.address, {
            onEnter: function (args) {
            },
            onLeave: function (retval) {
                if (typeret === "Ptr") {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + ptr(newret));
                    retval.replace(ptr(newret));
                } else if (typeret === "Boolean") {
                    let toRet = 0;
                    if (newret === "true") toRet = 1;
                    console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                    retval.replace(new NativePointer(toRet));
                } else {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + newret);
                    retval.replace(newret);
                }
            }
        });
    });
    console.log("*** Replacing return value of " + pattern + " with " + newret);
}

function changeReturnValueIOS(pattern: any, type: any, typeret: any, newret: any) {
    let res;
    if (type === "objc_method") {
        res = new ApiResolver("objc");
    } else {
        // SINGLE EXPORT
        res = new ApiResolver("module");
        pattern = "exports:" + pattern;
    }
    let matches = res.enumerateMatches(pattern);
    let targets = uniqBy(matches, JSON.stringify);
    targets.forEach(function (target: any) {
        Interceptor.attach(target.address, {
            onEnter: function (args) {
            },
            onLeave: function (retval) {
                if (typeret === "String") {
                    let a1 = ObjC.classes.NSString.stringWithString_(newret);
                    try {
                        console.log("*** " + pattern + " Replacing " + new ObjC.Object(retval) + " with " + a1);
                    } catch (err) {
                        console.log("*** " + pattern + " Replacing " + retval + " with " + a1);
                    }
                    retval.replace(a1);
                } else if (typeret === "Ptr") {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + ptr(newret));
                    retval.replace(ptr(newret));
                } else if (typeret === "Boolean") {
                    let toRet = 0;
                    if (newret === "true") toRet = 1;
                    console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                    retval.replace(new NativePointer(toRet));
                } else {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + newret);
                    retval.replace(newret);
                }
            }
        });
    });
    console.log("*** Replacing return value of " + pattern + " with " + newret);
}

function changereturnvalue(pattern: any, type: any, typeret: any, newret: any) {
    if (ObjC.available) {
        changeReturnValueIOS(pattern, type, typeret, newret);
    } else if (Java.available) {
        Java.perform(function () {
            changeReturnValueAndroid(pattern, type, typeret, newret);
        });
    } else {
        changeReturnValueGeneric(pattern, type, typeret, newret);
    }
}

// generic trace
function trace(pattern: any, type: any, backtrace: any) {
    // SINGLE EXPORT (ALL EXPORT OF A MODULE CAN BE A MESS AND CRASH THE APP)
    if (type == "export") {
        let res = new ApiResolver("module");
        pattern = "exports:" + pattern;
        let matches = res.enumerateMatches(pattern);
        let targets = uniqBy(matches, JSON.stringify);
        targets.forEach(function (target: any) {
            traceModule(target.address, target.name, backtrace);
        });
        //OBJC
    } else if (type.startsWith("objc")) {
        if (ObjC.available) {
            let res: any;
            if (type === "objc_class") {
                res = new ApiResolver("objc");
                pattern = "*[" + pattern + " *]";
            } else if (type === "objc_method") {
                res = new ApiResolver("objc");
            }
            let matches = res.enumerateMatchesSync(pattern);
            let targets = uniqBy(matches, JSON.stringify);
            targets.forEach(function (target: any) {
                traceObjC(target.address, target.name, backtrace);
            });
        }
        // ANDROID
    } else if (type.startsWith("java")) {
        if (Java.available) {
            Java.perform(function () {
                if (type === "java_class") {
                    let methodsDictionary = getJavaMethodArgumentTypes(pattern);
                    let targets = Object.keys(methodsDictionary!!);
                    targets.forEach(function (targetMethod) {
                        traceJavaMethod(targetMethod, backtrace);
                    });
                } else {
                    traceJavaMethod(pattern, backtrace);
                }
            });
        }
    }
}

function detachall() {
    Interceptor.detachAll();
}

function findexports(searchstring: any) {
    let results: {
        [key: string]: any
    } = {};
    let resolver = new ApiResolver("module");
    resolver.enumerateMatches("exports:*!*" + searchstring + "*").forEach((apiResolverMatch: ApiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}

function findimports(searchstring: any) {
    let results: {
        [key: string]: any
    } = {};
    let resolver = new ApiResolver("module");
    resolver.enumerateMatches("imports:*!*" + searchstring + "*").forEach((apiResolverMatch: ApiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}

function findobjcmethods(searchstring: any) {
    let results: {
        [key: string]: any
    } = {};
    let resolver = new ApiResolver("objc");
    resolver.enumerateMatches("*[*" + searchstring + "* *]").forEach((apiResolverMatch: ApiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}

function findjavamethods(searchstring: any) {
    let results: {
        [key: string]: any
    } = {}
    if (Java.available) {
        Java.perform(function () {
            let groups = []
            groups.push(Java.enumerateMethods('*' + searchstring + '*!*/s'))
            groups.push(Java.enumerateMethods('*!*' + searchstring + '*/s'))
            groups.forEach(g => {
                g.forEach(classLoader => {
                    classLoader.classes.forEach(c => {
                        let className = c.name;
                        c.methods.forEach(m => {
                            let methodSignature = className + "!" + m;
                            results[methodSignature] = null;
                        });
                    });
                });
            });
        });
    }
    return results;
}


// All exports
rpc.exports = {
    getallclasses, getallmodules, getmoduleimports, getmoduleexports,
    getclassmethods, findobjcmethods, findjavamethods, findimports,
    findexports, detachall, trace, changereturnvalue, getplatform
}