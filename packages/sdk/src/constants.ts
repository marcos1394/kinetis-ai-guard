// Configuración para Sui Testnet
export const TESTNET_CONFIG = {
    // El ID de tu paquete Kinetis desplegado
    PACKAGE_ID: "0x2a43da453e2061d404a3c1c63c38cf35f6586ebf48cb3b3c7df75dfed71f628b",
    
    // IDs de los objetos de configuración que creaste
    BUDGET_CONFIG_ID: "0x8af127fac78ffa126e4b94f28fa2c448eec258f674d4b2d50edf92879138076b",
    POLICY_CONFIG_ID: "0x20a8788de77c9049fb843ed70ea41a5dd769fe299bc7c74ba4f3985a578dbbc9",
    
    // Tu oráculo de Switchboard (SUI/USD)
    SWITCHBOARD_AGGREGATOR_ID: "0x5068b10f9e7ad15b853220f1b699535d3c985b77e21394fa43a91ab360e1e069",
    
    // Módulos del contrato
    MODULES: {
      FINANCE: "financial_rules",
      REGISTRY: "policy_registry",
      RULES: "policy_rules",
    },
    
    // Objeto Clock del sistema (siempre es el mismo)
    CLOCK_ID: "0x6",
  };