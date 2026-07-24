# AWS Polly y presupuesto — runbook de Alpha

Este runbook describe preparación y verificación; no crea recursos remotos ni revela identificadores de cuenta, claves o tokens. El propietario debe elegir los valores de presupuesto y confirmar cualquier acción en AWS u OpenRouter.

## Identidad y región

- Usar una identidad IAM técnica exclusiva de VSLingo; nunca la cuenta root.
- Usar inicialmente `us-east-1` y conservar las credenciales sólo como variables del VPS (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_POLLY_VOICE_ID`).
- Aplicar únicamente la política aprobada:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["polly:SynthesizeSpeech", "polly:DescribeVoices"],
      "Resource": "*"
    }
  ]
}
```

Verificar la identidad sin imprimir secretos mediante el panel IAM o `aws sts get-caller-identity` ejecutado por el propietario; el resultado no se copia a logs ni tickets públicos.

## Alerta de AWS Budget

1. El propietario define un importe mensual y los destinatarios de aviso.
2. En **AWS Billing → Budgets**, crear un presupuesto de coste mensual para la cuenta y moneda elegidas.
3. Añadir una alerta al umbral decidido (por ejemplo, porcentaje de consumo), con correo controlado por el propietario.
4. Confirmar en el panel que el presupuesto y la alerta aparecen activos, sin registrar account ID ni direcciones de correo en el repositorio.

## Límite de OpenRouter

1. Abrir el panel de OpenRouter con la cuenta propietaria.
2. Configurar el límite monetario de la clave/organización usada por el VPS con el importe aprobado.
3. Verificar visualmente el límite y conservar sólo la fecha y el responsable en la documentación operativa privada.

Las acciones de los dos apartados anteriores tienen impacto financiero e infraestructura: requieren confirmación explícita del propietario y un valor. En T09 no se creó ni verificó ningún presupuesto o límite remoto.
