(function(){function r(e,n,t){function o(i,f){if(!n[i]){if(!e[i]){var c="function"==typeof require&&require;if(!f&&c)return c(i,!0);if(u)return u(i,!0);var a=new Error("Cannot find module '"+i+"'");throw a.code="MODULE_NOT_FOUND",a}var p=n[i]={exports:{}};e[i][0].call(p.exports,function(r){var n=e[i][1][r];return o(n||r)},p,p.exports,r,e,n,t)}return n[i].exports}for(var u="function"==typeof require&&require,i=0;i<t.length;i++)o(t[i]);return o}return r})()({1:[function(require,module,exports){
"use strict";
// Definitions
let keystoreList = [];
let callbackG = null;
let authenticationResultInst = null;
/*
    Brida Functions
*/
function getallclasses() {
    let result = [];
    if (ObjC.available) {
        for (let className in ObjC.classes) {
            if (ObjC.classes.hasOwnProperty(className)) {
                result.push(className);
            }
        }
    }
    else if (Java.available) {
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
    let results = {};
    Process.enumerateModules().forEach((module) => {
        results[module.name] = module.base;
    });
    return results;
}
function getmoduleimports(importname) {
    let results = {};
    Process.enumerateModules().forEach((module) => {
        module.enumerateImports().forEach((moduleImports) => {
            if (module.name === importname) {
                results[moduleImports.type + ": " + moduleImports.name] = moduleImports.address;
            }
        });
    });
    return results;
}
function getmoduleexports(importname) {
    let results = {};
    Process.enumerateModules().forEach((module) => {
        module.enumerateExports().forEach((moduleExports) => {
            if (module.name === importname) {
                results[moduleExports.type + ": " + moduleExports.name] = moduleExports.address;
            }
        });
    });
    return results;
}
function getclassmethods(classname) {
    let results = {};
    if (ObjC.available) {
        let resolver = new ApiResolver("objc");
        resolver.enumerateMatches("*[" + classname + " *]").forEach((apiResolverMatch) => {
            results[apiResolverMatch.name] = apiResolverMatch.address;
        });
    }
    else if (Java.available) {
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
function getJavaMethodArgumentTypes(classname) {
    if (Java.available) {
        let results = {};
        Java.perform(function () {
            let hook = Java.use(classname);
            let res = hook.class.getDeclaredMethods();
            res.forEach(function (s) {
                let targetClassMethod = parseJavaMethod(s.toString());
                let delim = targetClassMethod.lastIndexOf(".");
                if (delim === -1)
                    return;
                let targetClass = targetClassMethod.slice(0, delim);
                let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length);
                let hookClass = Java.use(targetClass);
                let classMethodOverloads = hookClass[targetMethod].overloads;
                classMethodOverloads.forEach(function (cmo) {
                    // overload.argumentTypes is an array of objects representing the arguments. In the "className" field of each object there
                    // is the bytecode form of the class of the current argument
                    let argumentTypes = cmo.argumentTypes;
                    let argumentTypesArray = [];
                    argumentTypes.forEach(function (cmo) {
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
function parseJavaMethod(method) {
    let parSplit = method.split("(");
    let spaceSplit = parSplit[0].split(" ");
    return spaceSplit[spaceSplit.length - 1];
}
function getplatform() {
    if (Java.available) {
        return 0;
    }
    else if (ObjC.available) {
        return 1;
    }
    else {
        return 2;
    }
}
//INPUT LIKE: public boolean a.b.functionName(java.lang.String,java.lang.String)
//OUTPUT LIKE: ["java.lang.String","java.lang.String"]
function getJavaMethodArguments(method) {
    let m = method.match(/.*\((.*)\).*/);
    if (m[1] !== "") {
        return m[1].split(",");
    }
    else {
        return [];
    }
}
// remove duplicates from array
function uniqBy(array, key) {
    let seen = {};
    return array.filter(function (item) {
        let k = key(item);
        return seen.hasOwnProperty(k) ? false : (seen[k] = true);
    });
}
// print helper
function printArg(desc, arg) {
    if (arg != 0x0) {
        try {
            let objectArg = new ObjC.Object(arg);
            console.log("\t(" + objectArg.$className + ") " + desc + objectArg.toString());
        }
        catch (err2) {
            console.log("\t" + desc + arg);
        }
    }
    else {
        console.log("\t" + desc + "0x0");
    }
}
// trace Module functions
function traceModule(impl, name, backtrace) {
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
            }
            else {
                console.log("\tretval: ", retval);
            }
        }
    });
}
// trace a specific Java Method
function traceJavaMethod(pattern, backtrace) {
    let targetClassMethod = parseJavaMethod(pattern);
    let argsTargetClassMethod = getJavaMethodArguments(pattern);
    let delim = targetClassMethod.lastIndexOf(".");
    if (delim === -1)
        return;
    let targetClass = targetClassMethod.slice(0, delim);
    let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length);
    let hook = Java.use(targetClass);
    console.log("*** Tracing " + pattern);
    hook[targetMethod].overload.apply(hook[targetMethod], argsTargetClassMethod).implementation = function () {
        console.log("*** entered " + targetClassMethod);
        // print args
        if (arguments.length)
            console.log("Parameters:");
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
                currentStackTrace.forEach(function (st) {
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
    };
}
// trace ObjC methods
function traceObjC(impl, name, backtrace) {
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
function changeReturnValueAndroid(pattern, type, typeret, newret) {
    if (type === "java_method") {
        let targetClassMethod = parseJavaMethod(pattern);
        let argsTargetClassMethod = getJavaMethodArguments(pattern);
        let delim = targetClassMethod.lastIndexOf(".");
        if (delim === -1)
            return;
        let targetClass = targetClassMethod.slice(0, delim);
        let targetMethod = targetClassMethod.slice(delim + 1, targetClassMethod.length);
        let hook = Java.use(targetClass);
        hook[targetMethod].overload.apply(hook[targetMethod], argsTargetClassMethod).implementation = function () {
            let retval = this[targetMethod].apply(this, arguments);
            let toRet = newret;
            if (typeret === "String") {
                let stringClass = Java.use("java.lang.String");
                toRet = stringClass.$new(newret);
            }
            else if (typeret === "Ptr") {
                toRet = ptr(newret);
            }
            else if (typeret === "Boolean") {
                toRet = newret === "true";
            }
            console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
            return toRet;
        };
        // SINGLE EXPORT
    }
    else {
        let res = new ApiResolver("module");
        pattern = "exports:" + pattern;
        let matches = res.enumerateMatches(pattern);
        let targets = uniqBy(matches, JSON.stringify);
        targets.forEach(function (target) {
            Interceptor.attach(target.address, {
                onEnter: function (args) {
                },
                onLeave: function (retval) {
                    let toRet = newret;
                    if (typeret === "String") {
                        let stringClass = Java.use("java.lang.String");
                        toRet = stringClass.$new(newret);
                    }
                    else if (typeret === "ptr") {
                        toRet = ptr(newret);
                    }
                    else if (typeret === "Boolean") {
                        if (newret === "true") {
                            toRet = 1;
                        }
                        else {
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
function changeReturnValueGeneric(pattern, type, typeret, newret) {
    let res = new ApiResolver("module");
    pattern = "exports:" + pattern;
    let matches = res.enumerateMatches(pattern);
    let targets = uniqBy(matches, JSON.stringify);
    targets.forEach((target) => {
        Interceptor.attach(target.address, {
            onEnter: function (args) {
            },
            onLeave: function (retval) {
                if (typeret === "Ptr") {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + ptr(newret));
                    retval.replace(ptr(newret));
                }
                else if (typeret === "Boolean") {
                    let toRet = 0;
                    if (newret === "true")
                        toRet = 1;
                    console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                    retval.replace(new NativePointer(toRet));
                }
                else {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + newret);
                    retval.replace(newret);
                }
            }
        });
    });
    console.log("*** Replacing return value of " + pattern + " with " + newret);
}
function changeReturnValueIOS(pattern, type, typeret, newret) {
    let res;
    if (type === "objc_method") {
        res = new ApiResolver("objc");
    }
    else {
        // SINGLE EXPORT
        res = new ApiResolver("module");
        pattern = "exports:" + pattern;
    }
    let matches = res.enumerateMatches(pattern);
    let targets = uniqBy(matches, JSON.stringify);
    targets.forEach(function (target) {
        Interceptor.attach(target.address, {
            onEnter: function (args) {
            },
            onLeave: function (retval) {
                if (typeret === "String") {
                    let a1 = ObjC.classes.NSString.stringWithString_(newret);
                    try {
                        console.log("*** " + pattern + " Replacing " + new ObjC.Object(retval) + " with " + a1);
                    }
                    catch (err) {
                        console.log("*** " + pattern + " Replacing " + retval + " with " + a1);
                    }
                    retval.replace(a1);
                }
                else if (typeret === "Ptr") {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + ptr(newret));
                    retval.replace(ptr(newret));
                }
                else if (typeret === "Boolean") {
                    let toRet = 0;
                    if (newret === "true")
                        toRet = 1;
                    console.log("*** " + pattern + " Replacing " + retval + " with " + toRet);
                    retval.replace(new NativePointer(toRet));
                }
                else {
                    console.log("*** " + pattern + " Replacing " + retval + " with " + newret);
                    retval.replace(newret);
                }
            }
        });
    });
    console.log("*** Replacing return value of " + pattern + " with " + newret);
}
function changereturnvalue(pattern, type, typeret, newret) {
    if (ObjC.available) {
        changeReturnValueIOS(pattern, type, typeret, newret);
    }
    else if (Java.available) {
        Java.perform(function () {
            changeReturnValueAndroid(pattern, type, typeret, newret);
        });
    }
    else {
        changeReturnValueGeneric(pattern, type, typeret, newret);
    }
}
// generic trace
function trace(pattern, type, backtrace) {
    // SINGLE EXPORT (ALL EXPORT OF A MODULE CAN BE A MESS AND CRASH THE APP)
    if (type == "export") {
        let res = new ApiResolver("module");
        pattern = "exports:" + pattern;
        let matches = res.enumerateMatches(pattern);
        let targets = uniqBy(matches, JSON.stringify);
        targets.forEach(function (target) {
            traceModule(target.address, target.name, backtrace);
        });
        //OBJC
    }
    else if (type.startsWith("objc")) {
        if (ObjC.available) {
            let res;
            if (type === "objc_class") {
                res = new ApiResolver("objc");
                pattern = "*[" + pattern + " *]";
            }
            else if (type === "objc_method") {
                res = new ApiResolver("objc");
            }
            let matches = res.enumerateMatchesSync(pattern);
            let targets = uniqBy(matches, JSON.stringify);
            targets.forEach(function (target) {
                traceObjC(target.address, target.name, backtrace);
            });
        }
        // ANDROID
    }
    else if (type.startsWith("java")) {
        if (Java.available) {
            Java.perform(function () {
                if (type === "java_class") {
                    let methodsDictionary = getJavaMethodArgumentTypes(pattern);
                    let targets = Object.keys(methodsDictionary);
                    targets.forEach(function (targetMethod) {
                        traceJavaMethod(targetMethod, backtrace);
                    });
                }
                else {
                    traceJavaMethod(pattern, backtrace);
                }
            });
        }
    }
}
function detachall() {
    Interceptor.detachAll();
}
function findexports(searchstring) {
    let results = {};
    let resolver = new ApiResolver("module");
    resolver.enumerateMatches("exports:*!*" + searchstring + "*").forEach((apiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}
function findimports(searchstring) {
    let results = {};
    let resolver = new ApiResolver("module");
    resolver.enumerateMatches("imports:*!*" + searchstring + "*").forEach((apiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}
function findobjcmethods(searchstring) {
    let results = {};
    let resolver = new ApiResolver("objc");
    resolver.enumerateMatches("*[*" + searchstring + "* *]").forEach((apiResolverMatch) => {
        results[apiResolverMatch.name] = apiResolverMatch.address;
    });
    ;
    return results;
}
function findjavamethods(searchstring) {
    let results = {};
    if (Java.available) {
        Java.perform(function () {
            let groups = [];
            groups.push(Java.enumerateMethods('*' + searchstring + '*!*/s'));
            groups.push(Java.enumerateMethods('*!*' + searchstring + '*/s'));
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
};

},{}]},{},[1])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJhZ2VudC9icmlkYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTs7QUNBQSxjQUFjO0FBRWQsSUFBSSxZQUFZLEdBQVUsRUFBRSxDQUFDO0FBQzdCLElBQUksU0FBUyxHQUFRLElBQUksQ0FBQztBQUMxQixJQUFJLHdCQUF3QixHQUFRLElBQUksQ0FBQztBQUV6Qzs7RUFFRTtBQUNGLFNBQVMsYUFBYTtJQUNsQixJQUFJLE1BQU0sR0FBRyxFQUFFLENBQUE7SUFDZixJQUFJLElBQUksQ0FBQyxTQUFTLEVBQUU7UUFDaEIsS0FBSyxJQUFJLFNBQVMsSUFBSSxJQUFJLENBQUMsT0FBTyxFQUFFO1lBQ2hDLElBQUksSUFBSSxDQUFDLE9BQU8sQ0FBQyxjQUFjLENBQUMsU0FBUyxDQUFDLEVBQUU7Z0JBQ3hDLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7YUFDMUI7U0FDSjtLQUNKO1NBQU0sSUFBSSxJQUFJLENBQUMsU0FBUyxFQUFFO1FBQ3ZCLElBQUksQ0FBQyxPQUFPLENBQUM7WUFDVCxJQUFJLENBQUMsc0JBQXNCLENBQUM7Z0JBQ3hCLE9BQU8sRUFBRSxVQUFVLFNBQVM7b0JBQ3hCLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLENBQUM7Z0JBQzNCLENBQUM7Z0JBQ0QsVUFBVSxFQUFFO2dCQUNaLENBQUM7YUFDSixDQUFDLENBQUM7UUFDUCxDQUFDLENBQUMsQ0FBQztLQUNOO0lBQ0QsT0FBTyxNQUFNLENBQUM7QUFDbEIsQ0FBQztBQUVELFNBQVMsYUFBYTtJQUNsQixJQUFJLE9BQU8sR0FFUCxFQUFFLENBQUM7SUFDUCxPQUFPLENBQUMsZ0JBQWdCLEVBQUUsQ0FBQyxPQUFPLENBQUMsQ0FBQyxNQUFjLEVBQUUsRUFBRTtRQUNsRCxPQUFPLENBQUMsTUFBTSxDQUFDLElBQUksQ0FBQyxHQUFHLE1BQU0sQ0FBQyxJQUFJLENBQUM7SUFDdkMs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
