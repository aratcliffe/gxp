Ext.namespace("gxp");

gxp.Viewer = Ext.extend(Ext.util.Observable, {
    
    /** private: property[mapPanel]
     *  ``GeoExt.MapPanel``
     */
    
    /** api: config[mapItems]
     *  ``Array(Ext.Component)``
     *  Any items to be added to the map panel.
     */
    
    /** api: config[defaultToolType]
     *  ``String``
     *  The default tool plugin type. Default is "gx_tool"
     */
    defaultToolType: "gx_tool",

    /** api: config[tools]
     *  ``Array(gxp.plugins.Tool)``
     *  Any tools to be added to the viewer. Tools are plugins that will be
     *  plugged into this viewer's ``portal``. The portal`s ``map`` property
     *  references this viewer's map panel. The ``tools`` array also accepts
     *  configuration objects for plugins. The default ptype is ``gx_tool``.
     */
    
    /** api: property[tools]
     *  ``Object`` Storage of tool instances for this viewer, keyed by id
     */
    tools: null,
     
    /** api: config[defaultSourceType]
     *  ``String``
     *  The default layer source plugin type.
     */
     
    /** api: property[portalItems]
     *  ``Array(Ext.Component)``
     *  Items that make up the portal.
     */
     
    /** api: property[selectedLayer]
     *  ``GeoExt.data.LayerRecord`` The currently selected layer
     */
    selectedLayer: null,
     
    /** private: method[constructor]
     *  Construct the viewer.
     */
    constructor: function(config) {

        // add any custom application events
        this.addEvents(
            /** api: event[ready]
             *  Fires when application is ready for user interaction.
             */
            "ready",
            
            /** api: event[portalReady]
             *  Fires when portal is ready for interaction.
             */
            "portalReady",
            
            /** api: event[layerselectionchange]
             *  Fired by tools that offer layer selection, when a layer
             *  is selected. Listeners arguments:
             *  * tool - ``gxp.plugins.Tool`` the tool that was used to select
             *    the layer, or null if fired by this Viewer because a layer
             *    record with ``selected`` set to true was added/removed.
             *  * layerRecord - ``GeoExt.data.LayerRecord`` the record of the
             *    selected layer, or null if no layer is selected.
             */
            "layerselectionchange"
        );
        
        Ext.apply(this, {
            layerSources: {},
            portalItems: []
        });

        this.on("layerselectionchange", function(tool, rec) {
            this.selectedLayer = rec;
        }, this);

        this.loadConfig(config, this.applyConfig);
        gxp.Viewer.superclass.constructor.apply(this, arguments);
        
    },
    
    /** api: method[loadConfig]
     *  :arg config: ``Object`` The config object passed to the constructor.
     *
     *  Subclasses that load config asynchronously can override this to load
     *  any configuration before applyConfig is called.
     */
    loadConfig: function(config) {
        this.applyConfig(config);
    },
    
    applyConfig: function(config) {
        this.initialConfig = Ext.apply({}, config);
        Ext.apply(this, this.initialConfig);
        this.load();
    },
    
    load: function() {

        // pass on any proxy config to OpenLayers
        if (this.proxy) {
            OpenLayers.ProxyHost = this.proxy;
        }
        
        this.initMapPanel();
        
        this.initTools();
        
        // initialize all layer source plugins
        var config, queue = [];
        for (var key in this.sources) {
            queue.push(this.createSourceLoader(key));
        }
        
        // create portal when dom is ready
        queue.push(function(done) {
            Ext.onReady(function() {
                this.initPortal();
                done();
            }, this);
        });
        
        gxp.util.dispatch(queue, this.activate, this);
        
    },
    
    createSourceLoader: function(key) {
        return function(done) {
            var config = this.sources[key];
            config.projection = this.initialConfig.map.projection;
            this.addLayerSource({
                id: key,
                config: config,
                callback: done,
                fallback: function() {
                    // TODO: log these issues somewhere that the app can display
                    // them after loading.
                    // console.log(arguments);
                    done();
                },
                scope: this
            });
        };
    },
    
    addLayerSource: function(options) {
        var id = options.id || Ext.id(null, "gx-source-");
        var source = Ext.ComponentMgr.createPlugin(
            options.config, this.defaultSourceType
        );
        source.on({
            ready: function() {
                var callback = options.callback || Ext.emptyFn;
                callback.call(this, id);
            },
            failure: function() {
                var fallback = options.fallback || Ext.emptyFn;
                delete this.layerSources[id];
                fallback.apply(this, arguments);
            },
            scope: options.scope || this
        });
        this.layerSources[id] = source;
        source.init(this);
        
        return source;
    },
    
    initMapPanel: function() {
        
        var config = Ext.apply({}, this.initialConfig.map);
        var mapConfig = {};
        
        // split initial map configuration into map and panel config
        if (this.initialConfig.map) {
            var props = "theme,controls,projection,units,maxExtent,maxResolution,numZoomLevels".split(",");
            var prop;
            for (var i=props.length-1; i>=0; --i) {
                prop = props[i];
                if (prop in config) {
                    mapConfig[prop] = config[prop];
                    delete config[prop];
                }
            }
        }

        this.mapPanel = new GeoExt.MapPanel(Ext.applyIf({
            map: Ext.applyIf({
                theme: mapConfig.theme || null,
                controls: mapConfig.controls || [
                    new OpenLayers.Control.Navigation({zoomWheelEnabled: false}),
                    new OpenLayers.Control.PanPanel(),
                    new OpenLayers.Control.ZoomPanel(),
                    new OpenLayers.Control.Attribution()
                ],
                maxExtent: mapConfig.maxExtent && OpenLayers.Bounds.fromArray(mapConfig.maxExtent),
                numZoomLevels: mapConfig.numZoomLevels || 20
            }, mapConfig),
            center: config.center && new OpenLayers.LonLat(config.center[0], config.center[1]),
            layers: null,
            items: this.mapItems,
            tbar: config.tbar || {hidden: true}
        }, config));
        
        this.mapPanel.layers.on({
            "add": function(store, records) {
                var record;
                for (var i=records.length-1; i>= 0; i--) {
                    record = records[i];
                    if (record.get("selected") === true) {
                        this.fireEvent("layerselectionchange", null, record);
                    }
                }
            },
            "remove": function(store, record) {
                if (record.get("selected") === true) {
                    this.fireEvent("layerselectionchange", null, null);
                }
            },
            scope: this
        });
    },
    
    initTools: function() {
        this.tools = {};
        if (this.initialConfig.tools && this.initialConfig.tools.length > 0) {
            var tool;
            for (var i=0, len=this.initialConfig.tools.length; i<len; i++) {
                tool = Ext.ComponentMgr.createPlugin(
                    this.initialConfig.tools[i], this.defaultToolType
                );
                tool.init(this);
                this.tools[tool.id] = tool;
            }
        }
    },

    initPortal: function() {
        
        var config = this.portalConfig || {};
        var Constructor = config.renderTo ? Ext.Panel : Ext.Viewport;
        
        if (this.portalItems.length === 0) {
            this.mapPanel.region = "center";
            this.portalItems.push(this.mapPanel);
        }
        
        this.portal = new Constructor(Ext.applyIf(this.portalConfig || {}, {
            layout: "fit",
            hideBorders: true,
            items: {
                layout: "border",
                deferredRender: false,
                items: this.portalItems
            }
        }));
        
        this.fireEvent("portalReady");
    },
    
    activate: function() {
        // add any layers from config
        this.addLayers();

        // initialize tooltips
        Ext.QuickTips.init();
        
        this.fireEvent("ready");
    },
    
    addLayers: function() {
        var mapConfig = this.initialConfig.map;
        if(mapConfig && mapConfig.layers) {
            var conf, source, record, baseRecords = [], overlayRecords = [];
            for (var i=0; i<mapConfig.layers.length; ++i) {
                conf = mapConfig.layers[i];
                source = this.layerSources[conf.source];
                // source may not have loaded properly (failure handled elsewhere)
                if (source) {
                    record = source.createLayerRecord(conf);
                    if (record) {
                        if (record.get("group") === "background") {
                            baseRecords.push(record);
                        } else {
                            overlayRecords.push(record);
                        }
                    }
                }
            }
            
            // sort background records so visible layers are first
            // this is largely a workaround for an OpenLayers Google Layer issue
            // http://trac.openlayers.org/ticket/2661
            baseRecords.sort(function(a, b) {
                return a.get("layer").visibility < b.get("layer").visibility;
            });
            
            var panel = this.mapPanel;
            var map = panel.map;
            
            var records = baseRecords.concat(overlayRecords);
            if (records.length) {
                panel.layers.add(records);

                // set map center
                if(panel.center) {
                    // zoom does not have to be defined
                    map.setCenter(panel.center, panel.zoom);
                } else if (panel.extent) {
                    map.zoomToExtent(panel.extent);
                } else {
                    map.zoomToMaxExtent();
                }
            }
            
        }        
    },
    
    /** api:method[getSource]
     *  :param layerRec: ``GeoExt.data.LayerRecord`` the layer to get the
     *      source for.
     */
    getSource: function(layerRec) {
        return layerRec && this.layerSources[layerRec.get("source")];
    },

    /** private: method[getState]
     *  :returns: ``Object`` Representation of the app's current state.
     */ 
    getState: function() {

        // start with what was originally given
        var state = Ext.apply({}, this.initialConfig);
        
        // update anything that can change
        var center = this.mapPanel.map.getCenter();
        Ext.apply(state.map, {
            center: [center.lon, center.lat],
            zoom: this.mapPanel.map.zoom,
            layers: []
        });
        
        // include all layer config (and add new sources)
        this.mapPanel.layers.each(function(record){
            var layer = record.get("layer");
            if (layer.displayInLayerSwitcher) {
                var id = record.get("source");
                var source = this.layerSources[id];
                if (!source) {
                    throw new Error("Could not find source for layer '" + record.get("name") + "'");
                }
                // add layer
                state.map.layers.push(source.getConfigForRecord(record));
                if (!state.sources[id]) {
                    state.sources[id] = Ext.apply({}, source.initialConfig);
                }
            }
        }, this);
        
        return state;
    }
    
});
