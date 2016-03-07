(function() {
    "use strict";
    function merge(src, dest) {
        if (!dest || typeof dest !== "object") {
            return src;
        }
        if (!src || typeof src !== "object") {
            return dest;
        }
        Object.keys(dest).forEach(function(k) {
            src[k] = dest[k];
        });
        return src;
    }
    function clean(stateDef, props) {
        props.forEach(function(prop) {
            delete stateDef[prop];
        });
        return stateDef;
    }
    var STRIP_COMMENTS = /((\/\/.*$)|(\/\*[\s\S]*?\*\/))/gm;
    var ARGUMENT_NAMES = /([^\s,]+)/g;
    function getParamNames(func) {
        var fnStr = func.toString().replace(STRIP_COMMENTS, "");
        var result = fnStr.slice(fnStr.indexOf("(") + 1, fnStr.indexOf(")")).match(ARGUMENT_NAMES);
        if (result === null) result = [];
        return result;
    }
    function isFunction(func) {
        return typeof func === "function";
    }
    function $uiRouterModalProvider() {
        var provider = this;
        var config = {};
        var configured = false;
        var ALLOWED_PROPS = [ "controller", "controllerAs", "templateUrl", "rootState", "fallbackState", "viewName", "stickyOpeners", "resolve", "closeOnEscape" ];
        ALLOWED_PROPS.forEach(function(prop) {
            Object.defineProperty(provider, prop, {
                get: function() {
                    return config[prop];
                }
            });
        });
        provider.config = function(props) {
            if (configured) {
                console.warn("$uiRouterModal has already been configured.");
                return;
            }
            if (!props || typeof props !== "object") {
                throw new Error("No configuration {object} passed!");
            }
            Object.keys(props).forEach(function(key) {
                if (ALLOWED_PROPS.indexOf(key) === -1) {
                    throw new Error("Illegal configuration key: " + key);
                }
                config[key] = props[key];
            });
            configured = true;
        };
        $get.$inject = [ "$rootScope", "$state", "$previousState" ];
        function $get($rootScope, $state, $previousState) {
            return angular.extend({}, angular.extend(config, {
                $close: $close.bind(provider, $rootScope, $state, $previousState, config)
            }));
        }
        provider.$get = $get;
    }
    function $close(root, state, prev, config, goBack, cb) {
        function errHandler(err) {
            throw new Error(err);
        }
        function successHandler(res) {
            if (typeof cb === "function") {
                return cb(res);
            } else {
                return res;
            }
        }
        if (goBack) {
            return prev.go().catch(errHandler).then(successHandler);
        } else {
            try {
                return state.go(config.rootState).catch(errHandler).then(successHandler);
            } catch (err) {
                return state.go(config.fallbackState).catch(errHandler).then(successHandler);
            }
        }
    }
    $uiModalViewDirective.$inject = [ "$uiRouterModal" ];
    function $uiModalViewDirective($uiRouterModal) {
        return {
            restrict: "ACE",
            template: function() {
                return '<div ui-view="' + $uiRouterModal.viewName + '"></div>';
            }
        };
    }
    $uiModalFillDirective.$inject = [ "$state", "$stateParams", "$uiRouterModal", "$document", "$controller", "$templateRequest", "$compile", "$injector", "$q" ];
    function $uiModalFillDirective($state, $stateParams, $uiRouterModal, $document, $controller, $templateRequest, $compile, $injector, $q) {
        var original = $state.current.$$originalState;
        if (!original) {
            throw new Error("not a modal state!");
        }
        function invoke(fn, self, locals) {
            locals = locals || getParamNames(fn);
            return $injector.invoke(fn, self, locals);
        }
        function resolveAndDecorate($scope, $element, $attrs, ctrl) {
            var locals = {
                $scope: $scope,
                $element: $element,
                $attrs: $attrs
            };
            var ogResolve = original.resolve;
            var resolveKeys = ogResolve ? Object.keys(ogResolve) : [];
            function decorate(result) {
                result.forEach(function(value, i) {
                    locals[resolveKeys[i]] = value;
                });
                var ctrlArgs = [ ctrl, locals ];
                if (!!original.controllerAs) {
                    ctrlArgs = ctrlArgs.concat([ false, original.controllerAs ]);
                }
                return angular.extend(this, $controller.apply(this, ctrlArgs));
            }
            function resolve(keys) {
                return keys.map(function(key) {
                    return invoke(ogResolve[key]);
                });
            }
            return $q.all(resolve(resolveKeys)).then(decorate.bind(this));
        }
        var shouldRequestTemplate = false;
        if (isFunction(original.templateProvider)) {
            var tplRequest = null;
            shouldRequestTemplate = true;
        }
        return {
            restrict: "ACE",
            controllerAs: original.controllerAs,
            templateUrl: !shouldRequestTemplate ? original.templateUrl : "",
            controller: function($scope, $element, $attrs) {
                var ctrl;
                if (isFunction(original.controllerProvider)) {
                    ctrl = invoke(original.controllerProvider, null);
                } else {
                    ctrl = original.controller;
                }
                return resolveAndDecorate.call(this, $scope, $element, $attrs, ctrl);
            },
            compile: function() {
                if (shouldRequestTemplate) {
                    tplRequest = $templateRequest(invoke(original.templateProvider, null));
                }
                return function($scope, $element) {
                    if (tplRequest && tplRequest.$$state) {
                        tplRequest.then(function(html) {
                            $element.html($compile(html)($scope));
                        });
                    }
                    function unbind() {
                        $document.unbind("keyup", onKeyUp);
                    }
                    function onKeyUp(e) {
                        if (e.keyCode === 27) {
                            $uiRouterModal.$close($stateParams.goBack, $stateParams.cb);
                            unbind();
                        }
                    }
                    if (!!$uiRouterModal.closeOnEscape) {
                        $document.bind("keyup", onKeyUp);
                    }
                    $scope.$on("$destroy", unbind);
                };
            }
        };
    }
    $stateModalStateDecorator.$inject = [ "$stateProvider", "$uiRouterModalProvider" ];
    function $stateModalStateDecorator($stateProvider, $uiRouterModalProvider) {
        var originalState = $stateProvider.state;
        function modalStateFn(name, stateDef) {
            var props = [ "templateUrl", "controller", "resolve", "templateProvider", "controllerProvider", "controllerAs" ];
            var viewName = $uiRouterModalProvider.viewName;
            var absViewName = viewName + "@" + $uiRouterModalProvider.rootState;
            stateDef.views = stateDef.views || {};
            stateDef.sticky = stateDef.sticky || false;
            stateDef.views[absViewName] = {
                templateUrl: $uiRouterModalProvider.templateUrl,
                controller: $uiRouterModalProvider.controller,
                controllerAs: $uiRouterModalProvider.controllerAs,
                resolve: $uiRouterModalProvider.resolve,
                reloadOnSearch: true
            };
            Object.defineProperty(stateDef, "$$originalState", {
                value: {
                    controllerProvider: stateDef.controllerProvider,
                    templateProvider: stateDef.templateProvider,
                    controllerAs: stateDef.controllerAs,
                    resolve: merge(stateDef.resolve)
                },
                writable: false
            });
            clean(stateDef, props);
            return originalState.apply(this, [ name, stateDef ]);
        }
        $stateProvider.modalState = modalStateFn;
    }
    $stateStickyDecorator.$inject = [ "$stateProvider", "$uiRouterModalProvider" ];
    function $stateStickyDecorator($stateProvider, $uiRouterModalProvider) {
        $stateProvider.decorator("__sticky", function(state) {
            var stickyOpeners = $uiRouterModalProvider.stickyOpeners;
            var stateSticky = state.self.sticky;
            var modalState = !!state.self.$$originalState;
            if (!modalState && stateSticky === undefined && stickyOpeners !== undefined && !!stickyOpeners) {
                state.self.sticky = stickyOpeners;
            }
            return state;
        });
    }
    angular.module("angular.ui.router.modal", [ "ui.router", "ct.ui.router.extras" ]).provider("$uiRouterModal", $uiRouterModalProvider).directive("uiModalView", $uiModalViewDirective).directive("uiModalFill", $uiModalFillDirective).config($stateModalStateDecorator).config($stateStickyDecorator);
})();