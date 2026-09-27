import type { LegalEntity } from "./legal";

export type LegalSection = { heading: string; paragraphs: string[] };

export function termsSections(e: LegalEntity): LegalSection[] {
  return [
    {
      heading: "1. Quem somos",
      paragraphs: [
        `O Coolkies é oferecido por ${e.name}, inscrita sob o documento ${e.document}. Dúvidas sobre estes termos: ${e.contactEmail}.`,
      ],
    },
    {
      heading: "2. O serviço",
      paragraphs: [
        "O Coolkies é um sistema on-line para pequenos negócios registrarem vendas, clientes, estoque, produção e compras. Cada negócio funciona num workspace separado, e só quem foi convidado para ele enxerga os seus dados.",
      ],
    },
    {
      heading: "3. Conta e acesso",
      paragraphs: [
        "Você entra com Google ou com e-mail e senha. Contas com e-mail e senha precisam confirmar o e-mail antes do primeiro acesso.",
        "Você é responsável por manter sua senha em sigilo e pelas ações feitas com a sua conta. Quem administra um workspace responde pelos acessos que concede a outras pessoas.",
      ],
    },
    {
      heading: "4. Planos, teste grátis e cobrança",
      paragraphs: [
        "Toda conta nova tem 14 dias de teste grátis. Depois disso, para continuar registrando dados, é preciso assinar um plano.",
        "As assinaturas se renovam automaticamente a cada ciclo (mensal ou anual) por Pix Automático ou cartão de crédito, até você cancelar. Você pode cancelar a qualquer momento na tela de assinatura, e o acesso pago vai até o fim do ciclo já pago. Não há reembolso proporcional de ciclos em andamento.",
        "Se o pagamento não for feito, o workspace entra em modo somente leitura: você continua vendo tudo, mas não registra nada novo até regularizar.",
      ],
    },
    {
      heading: "5. Seus dados e os dados dos seus clientes",
      paragraphs: [
        "Os dados que você registra no Coolkies são seus. Em relação aos dados pessoais dos seus clientes, você é o controlador e nós atuamos como operador, tratando esses dados apenas para prestar o serviço.",
        "Você declara ter base legal para registrar os dados dos seus clientes e se compromete a atender os pedidos deles sobre esses dados.",
      ],
    },
    {
      heading: "6. Uso aceitável",
      paragraphs: [
        "É proibido usar o Coolkies para atividades ilegais, tentar acessar dados de outros workspaces, sobrecarregar o serviço de propósito ou automatizar acessos fora da API oficial. Podemos suspender contas que violem estas regras.",
      ],
    },
    {
      heading: "7. Disponibilidade",
      paragraphs: [
        "Trabalhamos para manter o serviço no ar e os dados protegidos, mas não garantimos funcionamento ininterrupto. Manutenções e falhas de fornecedores podem causar indisponibilidades temporárias.",
      ],
    },
    {
      heading: "8. Exclusão da conta",
      paragraphs: [
        "Você pode excluir sua conta a qualquer momento em Minha conta. A exclusão cancela sua assinatura e apaga, de forma definitiva, todos os workspaces em que você é dono, com todos os dados deles, inclusive os registrados por outros membros. Nos workspaces de outras pessoas, os registros que você fez continuam, sem vínculo com a sua conta.",
      ],
    },
    {
      heading: "9. Mudanças nestes termos",
      paragraphs: [
        "Quando estes termos mudarem, avisaremos no próprio app e pediremos um novo aceite antes de você continuar usando o serviço.",
      ],
    },
    {
      heading: "10. Lei aplicável",
      paragraphs: [
        "Estes termos seguem as leis brasileiras, incluindo o Código de Defesa do Consumidor e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).",
      ],
    },
  ];
}

export function privacySections(e: LegalEntity): LegalSection[] {
  return [
    {
      heading: "1. Quem cuida dos seus dados",
      paragraphs: [
        `${e.name} (${e.document}) é a controladora dos dados da sua conta. O contato do encarregado pelo tratamento de dados é ${e.contactEmail}.`,
      ],
    },
    {
      heading: "2. Que dados coletamos",
      paragraphs: [
        "Da sua conta: nome, e-mail, foto (quando você entra com Google) e senha, que guardamos só em forma criptografada.",
        "Para cobrança: CPF e os dados da assinatura. Os dados do cartão são digitados diretamente na Stripe e nunca passam pelos nossos servidores.",
        "Do uso: endereço IP e registros técnicos de acesso, usados para segurança e para limitar tentativas abusivas.",
        "Dos seus negócios: tudo o que você registra nos workspaces, como vendas, clientes, estoque e compras.",
      ],
    },
    {
      heading: "3. Para que usamos",
      paragraphs: [
        "Para prestar o serviço e cobrar a assinatura (execução de contrato), cumprir obrigações legais e fiscais (obrigação legal) e proteger o serviço contra fraude e abuso (legítimo interesse). Não vendemos seus dados e não os usamos para publicidade.",
      ],
    },
    {
      heading: "4. Com quem compartilhamos",
      paragraphs: [
        "Somente com os fornecedores necessários para o serviço funcionar: hospedagem (Vercel), banco de dados (Supabase), envio de e-mail (Resend), login (Google) e pagamentos (Stripe, e Banco Inter por meio do nosso gateway Pix). Eles tratam os dados só para essas finalidades.",
      ],
    },
    {
      heading: "5. Por quanto tempo guardamos",
      paragraphs: [
        "Enquanto sua conta existir. Quando você a exclui, apagamos seus dados e os workspaces em que você é dono. Registros de pagamento podem continuar com os provedores de pagamento pelo prazo que a lei exige.",
      ],
    },
    {
      heading: "6. Seus direitos",
      paragraphs: [
        "Em Minha conta você pode baixar uma cópia dos seus dados pessoais e excluir sua conta. Para corrigir dados, tirar dúvidas ou exercer qualquer outro direito previsto na LGPD, escreva para " + e.contactEmail + ".",
      ],
    },
    {
      heading: "7. Cookies",
      paragraphs: [
        "Usamos apenas o cookie de sessão, necessário para manter você conectado. Não usamos cookies de publicidade nem de rastreamento.",
      ],
    },
    {
      heading: "8. Segurança",
      paragraphs: [
        "Os dados trafegam criptografados, as senhas são guardadas com hash e cada workspace é isolado dos demais na camada de acesso ao banco.",
      ],
    },
    {
      heading: "9. Mudanças nesta política",
      paragraphs: [
        "Quando esta política mudar, avisaremos no próprio app e pediremos um novo aceite.",
      ],
    },
  ];
}
